const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
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

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 1024,
      system: `You are a scheduling assistant for an Integrative Healthcare clinic.
Your job is to help patients book appointments in a warm, professional manner.
Extract appointment details (date, time, service type, patient name) from the conversation.
When you have all required details, confirm them clearly with the patient before booking.`,
      messages: [{ role: 'user', content: message }],
    });

    res.json({ reply: msg.content[0].text });
  } catch (error) {
    console.error('Anthropic error:', error);
    res.status(500).json({ error: 'Assistant connection error. Please try again.' });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
