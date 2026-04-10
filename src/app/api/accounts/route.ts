import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";
import {
  renameGoogleAccount,
  removeGoogleAccount,
  removeAllGoogleAccounts,
  getGoogleAccounts,
  isDbAvailable,
} from "@/app/lib/db";

async function getAuthUserId(request: NextRequest): Promise<string | null> {
  if (!isDbAvailable()) return null;
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) return null;
  return getSessionUserId(sessionCookie.value);
}

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, ...params } = await request.json();

  switch (action) {
    case "rename": {
      if (!params.accountId || typeof params.displayName !== "string") {
        return NextResponse.json(
          { error: "accountId and displayName required" },
          { status: 400 }
        );
      }
      await renameGoogleAccount(params.accountId, params.displayName || null);
      return NextResponse.json({ success: true });
    }

    case "remove": {
      if (!params.accountId) {
        return NextResponse.json(
          { error: "accountId required" },
          { status: 400 }
        );
      }
      const removed = await removeGoogleAccount(params.accountId, userId);
      if (!removed) {
        return NextResponse.json(
          { error: "Account not found" },
          { status: 404 }
        );
      }
      const remaining = await getGoogleAccounts(userId);
      return NextResponse.json({
        success: true,
        remainingCount: remaining.length,
      });
    }

    case "removeAll": {
      await removeAllGoogleAccounts(userId);
      return NextResponse.json({ success: true, remainingCount: 0 });
    }

    case "list": {
      const accounts = await getGoogleAccounts(userId);
      return NextResponse.json({
        accounts: accounts.map((a) => ({
          id: a.id,
          email: a.email,
          displayName: a.display_name,
          isPrimary: a.is_primary,
        })),
      });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }
}
