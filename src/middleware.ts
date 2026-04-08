import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  // If user is on the homepage and has auth cookie, redirect to /app
  if (request.nextUrl.pathname === "/") {
    const hasTokens = request.cookies.has("gmail_tokens");
    if (hasTokens) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  // If user is on /app without auth cookie, redirect to homepage
  if (request.nextUrl.pathname === "/app") {
    const hasTokens = request.cookies.has("gmail_tokens");
    if (!hasTokens) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/app"],
};
