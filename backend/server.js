const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Anthropic Client ---
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Google Calendar Auth ---
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth });

// --- Email Transporter ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- Get Available Slots ---
async function getAvailableSlots({ days_ahead = 7 }) {
  const now = new Date();
  const end = new Date(now.getTime() + days_ahead * 24 * 60 * 60 * 1000);

  // Get busy times from Google Calendar
  const freeBusy = await calendar.freebusy.query({
    resource: {
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: 'primary' }],
    },
  });

  const busySlots = freeBusy.data.calendars.primary.busy || [];

  // Generate candidate slots: Mon–Fri, 9am–5pm, every hour
  const available = [];
  const cursor = new Date(now);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1); // start from next full hour

  while (cursor < end && available.length < 10) {
    const day = cursor.getDay();
    const hour = cursor.getHours();

    if (day >= 1 && day <= 5 && hour >= 9 && hour < 17) {
      const slotStart = cursor.toISOString();
      const slotEnd   = new Date(cursor.getTime() + 60 * 60 * 1000).toISOString();

      const isBusy = busySlots.some(b =>
        new Date(b.start) < new Date(slotEnd) &&
        new Date(b.end)   > new Date(slotStart)
      );

      if (!isBusy) {
        available.push({
          date: cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
          time: cursor.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          iso_date: cursor.toISOString().split('T')[0],
          iso_time: `${String(cursor.getHours()).padStart(2, '0')}:00`,
        });
      }
    }

    cursor.setHours(cursor.getHours() + 1);
  }

  return { available_slots: available };
}

// --- Tool Definition ---
const tools = [
  {
    name: 'get_available_slots',
    description: 'Fetches real available appointment slots from the clinic calendar for the next N days. Call this when the patient asks about availability, first available slot, or has not specified a date/time.',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead to search (default 7)' },
      },
      required: [],
    },
  },
  {
    name: 'book_appointment',
    description: 'Books an appointment on Google Calendar and sends a confirmation email to the patient. Call this only when you have collected the patient name, email, service type, preferred date, and preferred time.',
    input_schema: {
      type: 'object',
      properties: {
        patient_name:  { type: 'string', description: 'Full name of the patient' },
        patient_email: { type: 'string', description: 'Email address of the patient' },
        service_type:  { type: 'string', description: 'Type of service (e.g. Acupuncture, Functional Medicine)' },
        date:          { type: 'string', description: 'Appointment date in YYYY-MM-DD format' },
        time:          { type: 'string', description: 'Appointment start time in HH:MM (24h) format' },
        notes:         { type: 'string', description: 'Any additional notes from the patient' },
      },
      required: ['patient_name', 'patient_email', 'service_type', 'date', 'time'],
    },
  },
];

// --- Book Appointment Handler ---
async function bookAppointment({ patient_name, patient_email, service_type, date, time, notes }) {
  const startDateTime = new Date(`${date}T${time}:00`);
  const endDateTime   = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour

  // Create Google Calendar event
  const event = await calendar.events.insert({
    calendarId: 'primary',
    resource: {
      summary: `${service_type} – ${patient_name}`,
      description: notes || '',
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
      end:   { dateTime: endDateTime.toISOString(),   timeZone: 'America/New_York' },
      attendees: [{ email: patient_email }],
    },
  });

  // Send confirmation email
  await transporter.sendMail({
    from: `"Integrative Health Clinic" <${process.env.EMAIL_USER}>`,
    to: patient_email,
    subject: `Appointment Confirmed – ${service_type}`,
    html: `
      <h2>Your appointment is confirmed!</h2>
      <p>Hi ${patient_name},</p>
      <p>We've scheduled your <strong>${service_type}</strong> appointment for:</p>
      <p><strong>Date:</strong> ${date}<br/>
         <strong>Time:</strong> ${time}</p>
      ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
      <p>If you need to reschedule, reply to this email or call us at (555) 123-4567.</p>
      <p>See you soon,<br/>Integrative Health Clinic</p>
    `,
  });

  return { success: true, eventId: event.data.id };
}

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'Messages are required.' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a scheduling assistant for Integrative Health Clinic.

SERVICES (use these exact names only — never suggest others):
1. Functional Medicine
2. Mind-Body Therapy
3. Nutritional Counseling
4. Acupuncture

YOUR ONLY JOB: Collect these 5 pieces of information, then book the appointment.
- Patient full name
- Patient email address
- Service (must be one of the 4 above)
- Date (in YYYY-MM-DD format)
- Time (in HH:MM 24h format)

RULES:
- Ask for one missing piece at a time.
- If the patient names a service not in the list, say "We offer: Functional Medicine, Mind-Body Therapy, Nutritional Counseling, and Acupuncture. Which would you like?"
- Never invent new services or variations.
- If the patient asks for "first available", "any time", or does not specify a date/time, call get_available_slots and present up to 5 options clearly.
- Never say you lack access to availability — always call get_available_slots instead.
- Once you have all 5 pieces, call book_appointment immediately without asking again.
- Do not ask for insurance, symptoms, or any other information.`,
      tools,
      messages,
    });

    // Check if Claude wants to call a tool
    const toolUse = response.content.find(block => block.type === 'tool_use');

    if (toolUse && toolUse.name === 'get_available_slots') {
      let slotsResult;
      try {
        slotsResult = await getAvailableSlots(toolUse.input);
      } catch (err) {
        console.error('Availability error:', err.message, err.response?.data || '');
        slotsResult = { error: err.message };
      }

      const followUpMessages = [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(slotsResult),
          }],
        },
      ];

      const followUp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: `You are a scheduling assistant for Integrative Health Clinic.`,
        tools,
        messages: followUpMessages,
      });

      const textBlock = followUp.content.find(b => b.type === 'text');
      return res.json({ reply: textBlock ? textBlock.text : '' });
    }

    if (toolUse && toolUse.name === 'book_appointment') {
      let bookingResult;
      let bookingError;

      try {
        bookingResult = await bookAppointment(toolUse.input);
      } catch (err) {
        console.error('Booking error:', err);
        bookingError = err.message;
      }

      // Send tool result back to Claude for a natural confirmation message
      const toolResultMessages = [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: bookingError
              ? `Booking failed: ${bookingError}`
              : 'Appointment booked successfully and confirmation email sent.',
          }],
        },
      ];

      const finalResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: `You are a scheduling assistant for an Integrative Healthcare clinic.`,
        tools,
        messages: toolResultMessages,
      });

      const finalText = finalResponse.content.find(b => b.type === 'text');
      return res.json({
        reply: finalText ? finalText.text : 'Your appointment has been booked!',
        booked: !bookingError,
      });
    }

    // Normal conversational reply
    const textBlock = response.content.find(b => b.type === 'text');
    res.json({ reply: textBlock ? textBlock.text : '' });

  } catch (error) {
    console.error('Anthropic error:', error);
    res.status(500).json({ error: 'Assistant connection error. Please try again.' });
  }
});

// --- Google OAuth Routes ---
app.get('/auth', (req, res) => {
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.send',
    ],
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code.');

  try {
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    res.send(`
      <h2>Authorization successful!</h2>
      <p>Copy this refresh token into your <code>.env</code> as <code>GOOGLE_REFRESH_TOKEN</code>:</p>
      <pre style="background:#f4f4f4;padding:16px;border-radius:8px;word-break:break-all">${tokens.refresh_token}</pre>
      <p>Then restart the server.</p>
    `);
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).send('OAuth failed: ' + err.message);
  }
});

// --- Auth Test ---
app.get('/auth/test', async (req, res) => {
  try {
    const token = await auth.getAccessToken();
    res.json({
      status: 'ok',
      has_refresh_token: !!process.env.GOOGLE_REFRESH_TOKEN,
      refresh_token_preview: process.env.GOOGLE_REFRESH_TOKEN?.slice(0, 10) + '...',
      access_token_obtained: !!token.token,
    });
  } catch (err) {
    res.json({
      status: 'error',
      message: err.message,
      has_refresh_token: !!process.env.GOOGLE_REFRESH_TOKEN,
      refresh_token_preview: process.env.GOOGLE_REFRESH_TOKEN?.slice(0, 10) + '...',
      client_id_preview: process.env.GOOGLE_CLIENT_ID?.slice(0, 10) + '...',
    });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
