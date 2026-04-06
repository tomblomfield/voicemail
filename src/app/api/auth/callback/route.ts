import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, encryptTokens } from "@/app/lib/gmail";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const tokens = await exchangeCode(code);
    const encrypted = encryptTokens(tokens);

    const response = NextResponse.redirect(new URL("/", request.url));
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
