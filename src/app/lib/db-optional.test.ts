import { describe, expect, it, vi, beforeEach } from "vitest";

// These tests verify that all DB functions degrade gracefully when DATABASE_URL is unset.
// We must clear the env var BEFORE importing the module so the pool is never created.

describe("db module without DATABASE_URL", () => {
  let db: typeof import("./db");

  beforeEach(async () => {
    // Reset module cache so db.ts re-evaluates with no DATABASE_URL
    vi.resetModules();
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    db = await import("./db");
    // Restore so other test files aren't affected
    if (originalUrl !== undefined) {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it("isDbAvailable returns false", () => {
    expect(db.isDbAvailable()).toBe(false);
  });

  it("initDb is a no-op", async () => {
    await expect(db.initDb()).resolves.toBeUndefined();
  });

  it("upsertUser returns null", async () => {
    const result = await db.upsertUser("test@example.com");
    expect(result).toBeNull();
  });

  it("getUserByEmail returns null", async () => {
    const result = await db.getUserByEmail("test@example.com");
    expect(result).toBeNull();
  });

  it("updateUserProfile is a no-op", async () => {
    await expect(
      db.updateUserProfile("test@example.com", { homeAddress: "123 Main St" })
    ).resolves.toBeUndefined();
  });

  it("getUserMemories returns null", async () => {
    const result = await db.getUserMemories("test@example.com");
    expect(result).toBeNull();
  });

  it("saveUserMemories is a no-op", async () => {
    await expect(
      db.saveUserMemories("test@example.com", "some content")
    ).resolves.toBeUndefined();
  });

  it("getAllUsers returns empty array", async () => {
    const result = await db.getAllUsers();
    expect(result).toEqual([]);
  });
});
