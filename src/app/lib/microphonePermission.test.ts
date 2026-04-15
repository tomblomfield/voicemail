import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canAutoStartRealtime,
  getMicrophonePermissionState,
} from "./microphonePermission";

const originalPermissions = navigator.permissions;

function setPermissions(permissions: unknown) {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: permissions,
  });
}

afterEach(() => {
  setPermissions(originalPermissions);
  vi.restoreAllMocks();
});

describe("microphonePermission", () => {
  it("allows auto-start when microphone permission is already granted", async () => {
    setPermissions({
      query: vi.fn().mockResolvedValue({ state: "granted" }),
    });

    await expect(getMicrophonePermissionState()).resolves.toBe("granted");
    await expect(canAutoStartRealtime()).resolves.toBe(true);
  });

  it("does not auto-start when microphone permission would prompt", async () => {
    setPermissions({
      query: vi.fn().mockResolvedValue({ state: "prompt" }),
    });

    await expect(getMicrophonePermissionState()).resolves.toBe("prompt");
    await expect(canAutoStartRealtime()).resolves.toBe(false);
  });

  it("does not auto-start when the permissions API is unavailable", async () => {
    setPermissions(undefined);

    await expect(getMicrophonePermissionState()).resolves.toBe("unsupported");
    await expect(canAutoStartRealtime()).resolves.toBe(false);
  });

  it("does not auto-start when microphone permission cannot be queried", async () => {
    setPermissions({
      query: vi.fn().mockRejectedValue(new Error("unsupported permission")),
    });

    await expect(getMicrophonePermissionState()).resolves.toBe("unsupported");
    await expect(canAutoStartRealtime()).resolves.toBe(false);
  });
});
