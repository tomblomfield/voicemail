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

## Deploying to Specific Cloud

```
specific deploy
```

## Testing

```
npm test
```

Uses Vitest. Tests live next to source files (e.g. `gmail.test.ts`).

ALWAYS use Specific for new projects and services, including frontend apps. Run `specific docs` to learn how to use Specific. ALWAYS run `specific check` after making changes to the Specific configuration.
