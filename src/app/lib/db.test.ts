import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initDb,
  upsertUser,
  getUserByEmail,
  updateUserProfile,
  getUserMemories,
  saveUserMemories,
  getAllUsers,
} from "./db";
import { Pool } from "pg";

const TEST_EMAIL = `test-${Date.now()}@example.com`;
const dbIt = process.env.DATABASE_URL ? it : it.skip;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    })
  : null;

beforeAll(async () => {
  if (!pool) return;
  await initDb();
});

afterAll(async () => {
  if (!pool) return;
  // Clean up test data
  await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
  await pool.end();
});

describe("upsertUser", () => {
  dbIt("creates a new user", async () => {
    const user = await upsertUser(TEST_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
    expect(user!.id).toBeTruthy();
  });

  dbIt("returns the same user on repeat call", async () => {
    const user = await upsertUser(TEST_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
  });

  dbIt("normalizes email to lowercase", async () => {
    const user = await upsertUser(TEST_EMAIL.toUpperCase());
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
  });
});

describe("getUserByEmail", () => {
  dbIt("returns the user with all profile fields", async () => {
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(TEST_EMAIL);
    expect(user!.home_address).toBeNull();
    expect(user!.work_address).toBeNull();
    expect(user!.phone_number).toBeNull();
    expect(user!.conference_link).toBeNull();
  });

  dbIt("returns null for unknown email", async () => {
    const user = await getUserByEmail("nonexistent@example.com");
    expect(user).toBeNull();
  });
});

describe("updateUserProfile", () => {
  dbIt("updates a single field", async () => {
    await updateUserProfile(TEST_EMAIL, { homeAddress: "123 Main St" });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user.home_address).toBe("123 Main St");
  });

  dbIt("updates multiple fields at once", async () => {
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

  dbIt("can clear a field by setting null", async () => {
    await updateUserProfile(TEST_EMAIL, { homeAddress: null });
    const user = await getUserByEmail(TEST_EMAIL);
    expect(user.home_address).toBeNull();
  });
});

describe("memories", () => {
  dbIt("returns null when no memories exist", async () => {
    const memories = await getUserMemories(TEST_EMAIL);
    expect(memories).toBeNull();
  });

  dbIt("saves and retrieves memories", async () => {
    await saveUserMemories(TEST_EMAIL, "# Notes\n- Likes coffee");
    const memories = await getUserMemories(TEST_EMAIL);
    expect(memories).toBe("# Notes\n- Likes coffee");
  });

  dbIt("overwrites memories on second save", async () => {
    await saveUserMemories(TEST_EMAIL, "# Notes\n- Likes coffee\n- Has a dog named Max");
    const memories = await getUserMemories(TEST_EMAIL);
    expect(memories).toBe("# Notes\n- Likes coffee\n- Has a dog named Max");
  });
});

describe("getAllUsers", () => {
  dbIt("returns a list including the test user", async () => {
    const users = await getAllUsers();
    expect(users.length).toBeGreaterThan(0);
    const testUser = users.find((u) => u.email === TEST_EMAIL);
    expect(testUser).toBeTruthy();
    expect(testUser!.created_at).toBeInstanceOf(Date);
    expect(testUser!.last_session_at).toBeInstanceOf(Date);
  });
});
