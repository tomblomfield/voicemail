export type MicrophonePermissionState = PermissionState | "unsupported";

export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (
    typeof navigator === "undefined" ||
    !navigator.permissions ||
    typeof navigator.permissions.query !== "function"
  ) {
    return "unsupported";
  }

  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported";
  }
}

export async function canAutoStartRealtime(): Promise<boolean> {
  return (await getMicrophonePermissionState()) === "granted";
}
