import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";
import {
  removeGoogleAccount,
  removeAllGoogleAccounts,
  getGoogleAccounts,
} from "@/app/lib/db";

export async function GET(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const accountId = request.nextUrl.searchParams.get("accountId");
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const userId = sessionCookie
    ? getSessionUserId(sessionCookie.value)
    : null;

  if (accountId && userId) {
    // Remove a single account
    await removeGoogleAccount(accountId, userId);
    const remaining = await getGoogleAccounts(userId);
    if (remaining.length > 0) {
      return NextResponse.redirect(new URL("/app", origin));
    }
  } else if (userId) {
    // Full logout — remove all accounts
    await removeAllGoogleAccounts(userId);
  }

  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
