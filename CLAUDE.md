## Local development

Environment variables are not checked into the repo. Copy from the canonical source:

```
cp /Users/tom/Code/voice-email/.env .
```

Required vars: OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_SECRET.
See .env.example for details.

## Starting the server

Install dependencies if needed:

```sh
npm ci
```

Start the local dev server on port 3000:

```sh
npm run dev
```

If port 3000 is already in use, stop the existing listener first and then restart:

```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill -9 <pid>
npm run dev
```

The app should be available at http://localhost:3000.

## Deploying to Railway

The app is hosted on Railway (project: `voice-email`, service: `voice-email`, environment: `production`).

```
railway link --project voice-email
railway up --detach --service voice-email
```

The production URL is https://voice-email-production.up.railway.app.

## Querying production users

The production database is PostgreSQL on Railway. To list all signed-up users:

```sh
railway link --project voice-email
railway variables -s Postgres 2>&1 | grep DATABASE_PUBLIC_URL
```

Then query using the public URL:

```sh
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: '<DATABASE_PUBLIC_URL from above>' });
pool.query('SELECT email, created_at::date AS signed_up, last_session_at::date AS last_active FROM users ORDER BY created_at').then(r => {
  console.table(r.rows);
  console.log('Total:', r.rows.length);
  pool.end();
});
"
```

The public URL follows the pattern `postgresql://postgres:<password>@maglev.proxy.rlwy.net:<port>/railway`. The internal URL (`postgres.railway.internal`) only works from within Railway's network.

The `users` table schema:
- `id` (UUID, PK)
- `email` (VARCHAR 255, unique)
- `home_address`, `work_address` (TEXT)
- `phone_number` (VARCHAR 50)
- `conference_link` (TEXT)
- `created_at`, `last_session_at`, `updated_at` (TIMESTAMPTZ)

Related tables: `google_accounts` (linked OAuth accounts), `user_memories` (conversation context).

## Testing

```sh
npm test
```

Uses Vitest. Tests live next to source files (e.g. `gmail.test.ts`).

**All tests must pass locally, including `db.test.ts`.** The db tests run against a
local PostgreSQL database (`voicemail_dev`). Before running tests, ensure:

1. Local Postgres is running (`pg_isready` should show "accepting connections")
2. The `.env` file is present with `DATABASE_URL=postgresql://localhost:5432/voicemail_dev`
   (copy from canonical source: `cp /Users/tom/Code/voice-email/.env .`)

If `DATABASE_URL` is missing, `db.test.ts` will throw a clear error — do not skip or
bypass it. Always run `npm test` and confirm **0 skipped, 0 failed** before committing.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
