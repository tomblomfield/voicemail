import { NextResponse } from "next/server";
import { getAuthUrl, isAuthenticated } from "@/app/lib/gmail";

export async function GET() {
  if (isAuthenticated()) {
    return NextResponse.json({ authenticated: true });
  }
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
