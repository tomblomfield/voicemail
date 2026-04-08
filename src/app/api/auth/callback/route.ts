import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, encryptTokens } from "@/app/lib/gmail";

function getRedirectUri(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/auth/callback`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const redirectUri = getRedirectUri(request);
    const tokens = await exchangeCode(code, redirectUri);
    const encrypted = encryptTokens(tokens);

    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const origin = host ? `${proto}://${host}` : request.url;
    const response = NextResponse.redirect(new URL("/app", origin));
    response.cookies.set("gmail_tokens", encrypted, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });
    return response;
  } catch {
    console.error("OAuth callback error");
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
