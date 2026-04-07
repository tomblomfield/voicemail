## Local development

Environment variables are not checked into the repo. Copy from the canonical source:

```
cp /Users/tom/Code/voice-email/.env .
```

Required vars: OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_SECRET.
See .env.example for details.

## Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Google OAuth 2.0 for Gmail + Calendar access
- OpenAI Realtime API for voice interaction

## Testing

```
npm test
```

Uses Vitest. Tests live next to source files (e.g. `gmail.test.ts`).
