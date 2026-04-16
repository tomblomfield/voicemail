import crypto from "crypto";
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
      timezone VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_session_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add timezone column to existing installations
    ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(100);

    CREATE TABLE IF NOT EXISTS user_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS google_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL UNIQUE,
      display_name VARCHAR(100),
      encrypted_tokens TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nonce_hash VARCHAR(64) NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose VARCHAR(50) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS oauth_states_user_purpose_idx
      ON oauth_states (user_id, purpose);
  `);
}

function hashOAuthNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

export function createOAuthStateNonce(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function storeOAuthStateNonce(
  userId: string,
  nonce: string,
  expiresAt: Date,
  purpose: string = "addAccount"
): Promise<void> {
  if (!pool) throw new Error("Database not available");
  await pool.query(`DELETE FROM oauth_states WHERE expires_at <= NOW()`);
  await pool.query(
    `INSERT INTO oauth_states (nonce_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashOAuthNonce(nonce), userId, purpose, expiresAt]
  );
}

export async function consumeOAuthStateNonce(
  userId: string,
  nonce: string,
  purpose: string = "addAccount"
): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `UPDATE oauth_states
     SET used_at = NOW()
     WHERE nonce_hash = $1
       AND user_id = $2
       AND purpose = $3
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING id`,
    [hashOAuthNonce(nonce), userId, purpose]
  );
  return (result.rowCount ?? 0) > 0;
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
    `SELECT id, email, home_address, work_address, phone_number, conference_link, timezone,
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
    timezone?: string | null;
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
  if (fields.timezone !== undefined) {
    setClauses.push(`timezone = $${paramIndex++}`);
    values.push(fields.timezone);
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

// --- Google Accounts ---

export async function findUserByGoogleEmail(
  email: string
): Promise<{ userId: string; accountId: string } | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id AS account_id, user_id FROM google_accounts WHERE email = $1`,
    [email.toLowerCase()]
  );
  if (!result.rows[0]) return null;
  return {
    userId: result.rows[0].user_id,
    accountId: result.rows[0].account_id,
  };
}

export async function addGoogleAccount(
  userId: string,
  email: string,
  encryptedTokens: string,
  isPrimary: boolean = false
): Promise<{ id: string; email: string; is_primary: boolean }> {
  if (!pool) throw new Error("Database not available");
  const result = await pool.query(
    `INSERT INTO google_accounts (user_id, email, encrypted_tokens, is_primary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       encrypted_tokens = EXCLUDED.encrypted_tokens,
       is_primary = EXCLUDED.is_primary,
       updated_at = NOW()
     RETURNING id, email, is_primary`,
    [userId, email.toLowerCase(), encryptedTokens, isPrimary]
  );
  return result.rows[0];
}

export async function getGoogleAccounts(
  userId: string
): Promise<
  Array<{
    id: string;
    email: string;
    display_name: string | null;
    encrypted_tokens: string;
    is_primary: boolean;
  }>
> {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, email, display_name, encrypted_tokens, is_primary
     FROM google_accounts
     WHERE user_id = $1
     ORDER BY is_primary DESC, created_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function getGoogleAccountById(accountId: string): Promise<{
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  encrypted_tokens: string;
  is_primary: boolean;
} | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id, user_id, email, display_name, encrypted_tokens, is_primary
     FROM google_accounts WHERE id = $1`,
    [accountId]
  );
  return result.rows[0] || null;
}

export async function removeGoogleAccount(
  accountId: string,
  userId: string
): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `DELETE FROM google_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function removeAllGoogleAccounts(userId: string): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM google_accounts WHERE user_id = $1`, [userId]);
}

export async function renameGoogleAccount(
  accountId: string,
  displayName: string | null
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE google_accounts SET display_name = $1, updated_at = NOW() WHERE id = $2`,
    [displayName, accountId]
  );
}

export async function countGoogleAccounts(userId: string): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM google_accounts WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0]?.count || 0;
}

// --- User lookups by ID ---

export async function getUserById(userId: string) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id, email, home_address, work_address, phone_number, conference_link, timezone,
            created_at, last_session_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function updateUserProfileById(
  userId: string,
  fields: {
    homeAddress?: string | null;
    workAddress?: string | null;
    phoneNumber?: string | null;
    conferenceLink?: string | null;
    timezone?: string | null;
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
  if (fields.timezone !== undefined) {
    setClauses.push(`timezone = $${paramIndex++}`);
    values.push(fields.timezone);
  }

  values.push(userId);

  await pool.query(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
    values
  );
}

export async function getUserMemoriesById(
  userId: string
): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT content FROM user_memories WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0]?.content ?? null;
}

export async function saveUserMemoriesById(
  userId: string,
  content: string
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_memories (user_id, content)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET content = $2, updated_at = NOW()`,
    [userId, content]
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
