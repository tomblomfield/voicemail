import { NextRequest, NextResponse } from "next/server";
import {
  decryptTokens,
  hasRequiredGoogleScopes,
  getMissingScopes,
  GMAIL_FILTER_WRITE_SCOPE,
} from "@/app/lib/gmail";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";
import { getGoogleAccounts } from "@/app/lib/db";

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return NextResponse.json({
      authenticated: false,
      accounts: [],
      filterWriteEnabled: false,
    });
  }

  const userId = getSessionUserId(sessionCookie.value);
  if (!userId) {
    return NextResponse.json({
      authenticated: false,
      accounts: [],
      filterWriteEnabled: false,
    });
  }

  const dbAccounts = await getGoogleAccounts(userId);
  const accounts: Array<{
    id: string;
    email: string;
    displayName: string | null;
    isPrimary: boolean;
    filterWriteEnabled: boolean;
  }> = [];

  for (const a of dbAccounts) {
    try {
      const tokens = decryptTokens(a.encrypted_tokens);
      if (hasRequiredGoogleScopes(tokens)) {
        const missingScopes = getMissingScopes(tokens, [
          GMAIL_FILTER_WRITE_SCOPE,
        ]);
        accounts.push({
          id: a.id,
          email: a.email,
          displayName: a.display_name,
          isPrimary: a.is_primary,
          filterWriteEnabled: missingScopes.length === 0,
        });
      }
    } catch {
      // Skip accounts with invalid tokens
    }
  }

  if (accounts.length === 0) {
    return NextResponse.json({
      authenticated: false,
      accounts: [],
      filterWriteEnabled: false,
    });
  }

  return NextResponse.json({
    authenticated: true,
    accounts,
    filterWriteEnabled: accounts.every((a) => a.filterWriteEnabled),
  });
}
