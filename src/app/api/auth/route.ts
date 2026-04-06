import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/app/lib/gmail";

export async function GET(_request: NextRequest) {
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
