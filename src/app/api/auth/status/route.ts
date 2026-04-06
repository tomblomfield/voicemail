import { NextResponse } from "next/server";
import { isAuthenticated } from "@/app/lib/gmail";

export async function GET() {
  return NextResponse.json({ authenticated: isAuthenticated() });
}
