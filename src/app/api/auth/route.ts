import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/app/lib/gmail";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";
import { countGoogleAccounts } from "@/app/lib/db";

function getRedirectUri(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/auth/callback`;
}

const MAX_ACCOUNTS = 5;

export async function GET(request: NextRequest) {
  const addAccount = request.nextUrl.searchParams.get("addAccount") === "true";
  const redirectUri = getRedirectUri(request);

  if (addAccount) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    const userId = getSessionUserId(sessionCookie.value);
    if (!userId) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    const count = await countGoogleAccounts(userId);
    if (count >= MAX_ACCOUNTS) {
      return NextResponse.redirect(
        new URL("/app?error=max_accounts", request.url)
      );
    }

    const url = getAuthUrl(redirectUri, { state: "addAccount" });
    return NextResponse.redirect(url);
  }

  // Check if already authenticated
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (sessionCookie) {
    const userId = getSessionUserId(sessionCookie.value);
    if (userId) {
      const count = await countGoogleAccounts(userId);
      if (count > 0) {
        return NextResponse.json({ authenticated: true });
      }
    }
  }

  const url = getAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
