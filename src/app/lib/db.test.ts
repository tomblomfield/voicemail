import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initDb,
  upsertUser,
  getUserByEmail,
  updateUserProfile,
  getUserMemories,
  saveUserMemories,
  getAllUsers,
  createOAuthStateNonce,
  storeOAuthStateNonce,
  consumeOAuthStateNonce,
} from "./db";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy the .env file first:\n" +
      "  cp /Users/tom/Code/voice-email/.env .\n" +
      "Local Postgres must be running with the voicemail_dev database."
  );
}

const TEST_EMAIL = `test-${Date.now()}@example.com`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
});

beforeAll(async () => {
  await initDb();
});

afterAll(async () => {
  // Clean up test data
  await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
  await pool.end();
});

describe("upsertUser", () => {
  it("creates a new user", async () => {
    const user = await upsertUser(TEST_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
    expect(user!.id).toBeTruthy();
  });

  it("returns the same user on repeat call", async () => {
    const user = await upsertUser(TEST_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
  });

  it("normalizes email to lowercase", async () => {
    const user = await upsertUser(TEST_EMAIL.toUpperCase());
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
  });
});

describe("getUserByEmail", () => {
  it("returns the user with all profile fields", async () => {
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
    expect(user!.home_address).toBeNull();
    expect(user!.work_address).toBeNull();
    expect(user!.phone_number).toBeNull();
    expect(user!.conference_link).toBeNull();
  });

  it("returns null for unknown email", async () => {
    const user = await getUserByEmail("nonexistent@example.com");
    expect(user).toBeNull();
  });
});

describe("updateUserProfile", () => {
  it("updates a single field", async () => {
    await updateUserProfile(TEST_EMAIL, { homeAddress: "123 Main St" });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user.home_address).toBe("123 Main St");
  });

  it("updates multiple fields at once", async () => {
    await updateUserProfile(TEST_EMAIL, {
      workAddress: "456 Office Blvd",
      phoneNumber: "+1-555-0100",
      conferenceLink: "https://zoom.us/my/testuser",
    });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user.work_address).toBe("456 Office Blvd");
    expect(user.phone_number).toBe("+1-555-0100");
    expect(user.conference_link).toBe("https://zoom.us/my/testuser");
    // home_address should still be set from previous test
    expect(user.home_address).toBe("123 Main St");
  });

  it("can clear a field by setting null", async () => {
    await updateUserProfile(TEST_EMAIL, { homeAddress: null });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user.home_address).toBeNull();
  });
});

describe("memories", () => {
  it("returns null when no memories exist", async () => {
    const memories = await getUserMemories(TEST_EMAIL);
    expect(memories).toBeNull();
  });

  it("saves and retrieves memories", async () => {
    await saveUserMemories(TEST_EMAIL, "# Notes\n- Likes coffee");
    const memories = await getUserMemories(TEST_EMAIL);
    expect(memories).toBe("# Notes\n- Likes coffee");
  });

  it("overwrites memories on second save", async () => {
    await saveUserMemories(TEST_EMAIL, "# Notes\n- Likes coffee\n- Has a dog named Max");
    const memories = await getUserMemories(TEST_EMAIL);
    expect(memories).toBe("# Notes\n- Likes coffee\n- Has a dog named Max");
  });
});

describe("timezone in profile", () => {
  it("starts as null", async () => {
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user!.timezone).toBeNull();
  });

  it("can be set via updateUserProfile", async () => {
    await updateUserProfile(TEST_EMAIL, { timezone: "America/Los_Angeles" });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user!.timezone).toBe("America/Los_Angeles");
  });

  it("persists across other field updates", async () => {
    await updateUserProfile(TEST_EMAIL, { phoneNumber: "+1-555-9999" });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user!.timezone).toBe("America/Los_Angeles");
    expect(user!.phone_number).toBe("+1-555-9999");
  });

  it("can be changed to a different timezone", async () => {
    await updateUserProfile(TEST_EMAIL, { timezone: "America/New_York" });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user!.timezone).toBe("America/New_York");
  });

  it("can be cleared by setting null", async () => {
    await updateUserProfile(TEST_EMAIL, { timezone: null });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user!.timezone).toBeNull();
  });
});

describe("getAllUsers", () => {
  it("returns a list including the test user", async () => {
    const users = await getAllUsers();
    expect(users.length).toBeGreaterThan(0);
    const testUser = users.find((u) => u.email === TEST_EMAIL);
    expect(testUser).toBeTruthy();
    expect(testUser!.created_at).toBeInstanceOf(Date);
    expect(testUser!.last_session_at).toBeInstanceOf(Date);
  });
});

describe("oauth state nonces", () => {
  it("allows a stored nonce to be consumed exactly once", async () => {
    const user = await upsertUser(TEST_EMAIL);
    expect(user).not.toBeNull();
    const nonce = createOAuthStateNonce();

    await storeOAuthStateNonce(
      user!.id,
      nonce,
      new Date(Date.now() + 10 * 60 * 1000)
    );

    await expect(consumeOAuthStateNonce(user!.id, nonce)).resolves.toBe(true);
    await expect(consumeOAuthStateNonce(user!.id, nonce)).resolves.toBe(false);
  });

  it("rejects expired nonces", async () => {
    const user = await upsertUser(TEST_EMAIL);
    expect(user).not.toBeNull();
    const nonce = createOAuthStateNonce();

    await storeOAuthStateNonce(user!.id, nonce, new Date(Date.now() - 1000));

    await expect(consumeOAuthStateNonce(user!.id, nonce)).resolves.toBe(false);
  });
});
