# Integrative Healthcare AI Scheduling Assistant

An AI-powered appointment booking system for integrative medicine clinics, built with Claude AI and Google Calendar.

## Stack
- **Frontend**: Static HTML/CSS with embedded AI chat widget (port 3000)
- **Backend**: Node.js/Express API server (port 3001)
- **AI**: Claude 3.5 Sonnet (Anthropic API)
- **Calendar**: Google Calendar API (OAuth2)
- **Orchestration**: Docker Compose

## Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/your-org/integrative-healthcare-scheduler.git
cd integrative-healthcare-scheduler
```

### 2. Configure environment variables
```bash
cp .env.example .env
# Fill in your API keys in .env
```

### 3. Run with Docker
```bash
docker-compose up --build
```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Required Setup
- [ ] Google Cloud Console: Enable Calendar API, create OAuth2 credentials
- [ ] Generate Google refresh token via OAuth flow
- [ ] Anthropic API key from https://console.anthropic.com
- [ ] HIPAA Review: Ensure Google Workspace BAA is in place before handling PHI

## Deployment
Push to GitHub and deploy via [Vercel](https://vercel.com) or [Render](https://render.com).
Store all API keys as environment variables in your hosting provider — never commit `.env` to git.

## Folder Structure
```
/
├── docker-compose.yml
├── .env.example
├── README.md
├── /backend
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
└── /frontend
    ├── index.html
    ├── style.css
    └── Dockerfile
```
