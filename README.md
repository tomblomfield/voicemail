# Voice Nav

Hands-free email triage for your commute. Uses OpenAI's Realtime API for voice interaction and Gmail API to read, reply, skip, and archive emails — all by voice.

Open the app on your phone, tap **Start**, and your AI assistant walks through your unread emails one by one. No screen needed.

## How it works

- **Voice in/out**: Your browser connects directly to OpenAI's Realtime API via WebRTC for low-latency speech-to-speech conversation
- **Email operations**: The AI calls tools (get emails, reply, archive, skip) that hit your server's Gmail API integration
- **Driving-friendly UI**: Dark theme, single big button, minimal visual elements

## Prerequisites

- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to the Realtime API
- A [Google Cloud project](https://console.cloud.google.com/) with the Gmail API enabled

## Setup

### 1. Clone and install

```bash
git clone https://github.com/tomblomfield/voice-email.git
cd voice-email
npm install
```

### 2. Set up Google OAuth credentials

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (application type: Web application)
3. Add `http://localhost:3000/api/auth/callback` as an **Authorized redirect URI**
4. Enable the **Gmail API** at [APIs & Services → Library → Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your keys:

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret from Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` (default) |

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Connect Gmail** — On first visit, you'll be prompted to sign in with Google and grant email permissions. Tokens are cached locally in `token.json`.
2. **Tap Start** — The AI greets you and tells you how many unread emails you have.
3. **Listen and respond** — For each email, the AI reads a short summary (sender, subject, key points) and asks what you'd like to do:
   - **Reply** — Tell the AI what to say, it drafts and reads it back for confirmation before sending
   - **Skip** — Marks as read, moves to next
   - **Archive** — Removes from inbox, moves to next
4. **Tap Stop** when you're done.

## Tech stack

- [Next.js](https://nextjs.org/) — App framework
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) — Speech-to-speech via WebRTC
- [@openai/agents](https://github.com/openai/openai-agents-js) — Agent + tool framework
- [Google Gmail API](https://developers.google.com/gmail/api) — Email operations via OAuth2

## License

MIT
