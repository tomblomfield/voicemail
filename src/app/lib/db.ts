import { Pool } from "pg";

// Pool is only created when DATABASE_URL is set.
// All exported functions gracefully degrade when Postgres is unavailable.
const pool: Pool | null = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
  : null;

function isDbAvailable(): boolean {
  return pool !== null;
}

export { isDbAvailable };

export async function initDb(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      home_address TEXT,
      work_address TEXT,
      phone_number VARCHAR(50),
      conference_link TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_session_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    );
  `);
}

// --- Users ---

export async function upsertUser(email: string): Promise<{ id: string; email: string } | null> {
  if (!pool) return null;
  const result = await pool.query(
    `INSERT INTO users (email, last_session_at)
     VALUES ($1, NOW())
     ON CONFLICT (email) DO UPDATE SET last_session_at = NOW(), updated_at = NOW()
     RETURNING id, email`,
    [email.toLowerCase()]
  );
  return result.rows[0];
}

export async function getUserByEmail(email: string) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id, email, home_address, work_address, phone_number, conference_link,
            created_at, last_session_at, updated_at
     FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
}

export async function updateUserProfile(
  email: string,
  fields: {
    homeAddress?: string | null;
    workAddress?: string | null;
    phoneNumber?: string | null;
    conferenceLink?: string | null;
  }
): Promise<void> {
  if (!pool) return;
  const setClauses: string[] = ["updated_at = NOW()"];
  const values: any[] = [];
  let paramIndex = 1;

  if (fields.homeAddress !== undefined) {
    setClauses.push(`home_address = $${paramIndex++}`);
    values.push(fields.homeAddress);
  }
  if (fields.workAddress !== undefined) {
    setClauses.push(`work_address = $${paramIndex++}`);
    values.push(fields.workAddress);
  }
  if (fields.phoneNumber !== undefined) {
    setClauses.push(`phone_number = $${paramIndex++}`);
    values.push(fields.phoneNumber);
  }
  if (fields.conferenceLink !== undefined) {
    setClauses.push(`conference_link = $${paramIndex++}`);
    values.push(fields.conferenceLink);
  }

  values.push(email.toLowerCase());

  await pool.query(
    `UPDATE users SET ${setClauses.join(", ")} WHERE email = $${paramIndex}`,
    values
  );
}

// --- Memories ---

export async function getUserMemories(email: string): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT m.content FROM user_memories m
     JOIN users u ON u.id = m.user_id
     WHERE u.email = $1`,
    [email.toLowerCase()]
  );
  return result.rows[0]?.content ?? null;
}

export async function saveUserMemories(email: string, content: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_memories (user_id, content)
     SELECT id, $2 FROM users WHERE email = $1
     ON CONFLICT (user_id) DO UPDATE SET content = $2, updated_at = NOW()`,
    [email.toLowerCase(), content]
  );
}

// --- Signups log ---

export async function getAllUsers(): Promise<Array<{ email: string; created_at: Date; last_session_at: Date }>> {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT email, created_at, last_session_at FROM users ORDER BY created_at DESC`
  );
  return result.rows;
}
