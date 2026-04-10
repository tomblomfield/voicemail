import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode,
  encryptTokens,
  getUserEmail,
} from "@/app/lib/gmail";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  createSessionCookieValue,
  getSessionUserId,
} from "@/app/lib/session";
import {
  initDb,
  upsertUser,
  findUserByGoogleEmail,
  addGoogleAccount,
  countGoogleAccounts,
} from "@/app/lib/db";

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

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const redirectUri = getRedirectUri(request);
    const tokens = await exchangeCode(code, redirectUri);
    const encrypted = encryptTokens(tokens);

    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      "";
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const origin = host ? `${proto}://${host}` : request.url;
    const response = NextResponse.redirect(new URL("/app", origin));

    await initDb();

    const email = await getUserEmail(tokens);
    const isAddAccount = state === "addAccount";
    let userId: string;

    if (isAddAccount) {
      // Adding account to an existing user session
      const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
      const existingUserId = sessionCookie
        ? getSessionUserId(sessionCookie.value)
        : null;

      if (!existingUserId) {
        // Session expired during OAuth — treat as fresh login
        const existing = await findUserByGoogleEmail(email);
        if (existing) {
          userId = existing.userId;
          await addGoogleAccount(userId, email, encrypted, false);
        } else {
          const user = await upsertUser(email);
          if (!user) {
            return NextResponse.json(
              { error: "Database error" },
              { status: 500 }
            );
          }
          userId = user.id;
          await addGoogleAccount(userId, email, encrypted, true);
        }
      } else {
        userId = existingUserId;
        const isPrimary = (await countGoogleAccounts(userId)) === 0;
        await addGoogleAccount(userId, email, encrypted, isPrimary);
      }
    } else {
      // Regular login
      const existing = await findUserByGoogleEmail(email);
      if (existing) {
        userId = existing.userId;
        await addGoogleAccount(userId, email, encrypted, false);
        await upsertUser(email);
      } else {
        const user = await upsertUser(email);
        if (!user) {
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 }
          );
        }
        userId = user.id;
        await addGoogleAccount(userId, email, encrypted, true);
      }
    }

    response.cookies.set(
      SESSION_COOKIE_NAME,
      createSessionCookieValue(userId),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      }
    );

    console.log(
      `auth_callback: ${isAddAccount ? "account_added" : "login"} email=${email}`
    );

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
