import { NextRequest, NextResponse } from "next/server";
import {
  decryptTokens,
  getMissingScopes,
  GMAIL_FILTER_WRITE_SCOPE,
} from "@/app/lib/gmail";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get("gmail_tokens");
  if (!cookie) {
    return NextResponse.json({
      authenticated: false,
      filterWriteEnabled: false,
      missingScopes: [GMAIL_FILTER_WRITE_SCOPE],
    });
  }

  try {
    const tokens = decryptTokens(cookie.value);
    const missingScopes = getMissingScopes(tokens, [GMAIL_FILTER_WRITE_SCOPE]);
    return NextResponse.json({
      authenticated: true,
      filterWriteEnabled: missingScopes.length === 0,
      missingScopes,
    });
  } catch {
    return NextResponse.json({
      authenticated: false,
      filterWriteEnabled: false,
      missingScopes: [GMAIL_FILTER_WRITE_SCOPE],
    });
  }
}
