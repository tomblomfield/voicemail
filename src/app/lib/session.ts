import { encryptTokens, decryptTokens } from "./gmail";

export const SESSION_COOKIE_NAME = "voicemail_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function createSessionCookieValue(userId: string): string {
  return encryptTokens({ userId });
}

export function getSessionUserId(cookieValue: string): string | null {
  try {
    const data = decryptTokens(cookieValue);
    return data?.userId || null;
  } catch {
    return null;
  }
}
