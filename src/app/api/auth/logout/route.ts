import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.delete("gmail_tokens");
  return response;
}
