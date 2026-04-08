# Voicemail AI

**[Try it live](https://voice-email-production.up.railway.app)** — connect your Gmail and triage your inbox by voice in under 60 seconds.

---

Hands-free email and calendar for your commute. Uses OpenAI's Realtime API for voice interaction plus Google APIs to triage email, check your calendar, infer invite defaults, and send invitations by voice.

Open Voicemail AI on your phone, tap **Start**, and your AI assistant walks through your unread emails one by one. No screen needed.

## How it works

- **Voice in/out**: Your browser connects directly to OpenAI's Realtime API via WebRTC for low-latency speech-to-speech conversation
- **Google operations**: The AI calls tools that hit your server's Gmail and Calendar integrations
- **Driving-friendly UI**: Dark theme, single big button, minimal visual elements

## Usage

1. **Connect Google** — On first visit, you'll be prompted to sign in with Google and grant Gmail + Calendar permissions.
2. **Tap Start** — The AI can triage unread emails, check upcoming calendar events, and schedule new invites.
3. **Listen and respond** — For each email, the AI reads a short summary (sender, subject, key points) and asks what you'd like to do:
   - **Reply** — Tell the AI what to say, it drafts and reads it back for confirmation before sending
   - **Skip** — Marks as read, moves to next
   - **Archive** — Removes from inbox, moves to next
   - **Block** — Say "block this sender" to auto-trash all future emails from them
4. **Manage filters** — Ask the AI to auto-archive emails like the current one. It will suggest a filter strategy (by sender, or by sender + subject) and confirm before creating it.
5. **Unsubscribe** — Say "unsubscribe from this" and the AI will find and follow the unsubscribe link for you, so you stop getting emails from that sender.
6. **Ask about your calendar** — For example: "What's on my calendar this afternoon?", "Am I meeting with Sarah?", or "Set up a Zoom with Sarah tomorrow at 3."
7. **Tap Stop** when you're done.

## Tech stack

- [Next.js](https://nextjs.org/) — App framework
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) — Speech-to-speech via WebRTC
- [@openai/agents](https://github.com/openai/openai-agents-js) — Agent + tool framework
- [Google Gmail API](https://developers.google.com/gmail/api) — Email operations via OAuth2
- [Google Calendar API](https://developers.google.com/workspace/calendar/api/guides/overview) — Calendar reads and invite creation

## Self-hosting

If you'd like to run your own instance instead of using the [live site](https://voice-email-production.up.railway.app), follow the steps below.

### Prerequisites

- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to the Realtime API
- A [Google Cloud project](https://console.cloud.google.com/) with the Gmail API and Google Calendar API enabled

### 1. Clone and install

```bash
git clone https://github.com/tomblomfield/voicemail.git
cd voicemail
npm install
```

### 2. Set up Google OAuth credentials

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (application type: Web application)
3. Add `http://localhost:3000/api/auth/callback` as an **Authorized redirect URI**
4. Enable the **Gmail API** at [APIs & Services → Library → Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
5. Enable the **Google Calendar API** at [APIs & Services → Library → Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)

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
| `VOICEMAIL_SITE_URL` | Optional footer link used in outbound emails |
| `BROWSER_USE_API_KEY` | Optional — [Browser Use Cloud](https://cloud.browser-use.com/settings?tab=api-keys&new=1) API key for browser-based unsubscribe. Without this, unsubscribe only works via one-click headers and mailto links; emails requiring a browser interaction will suggest blocking the sender instead. |

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## License

MIT
