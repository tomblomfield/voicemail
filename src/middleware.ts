import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "voicemail_session";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    if (request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  if (request.nextUrl.pathname === "/app") {
    if (!request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/app"],
};
