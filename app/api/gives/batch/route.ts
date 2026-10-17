import { NextRequest, NextResponse } from "next/server";
import { getBatchGiveSummaries } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { withLogging } from "@/lib/requestLogger";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const MAX_ACCOUNTS = 50;

/**
 * POST /api/gives/batch
 *
 * Accepts { accounts: string[] } and returns give summaries for all accounts
 * at once, avoiding N+1 requests from the frontend.
 *
 * Acceptance criteria:
 *   - Returns give stats for all provided accounts
 *   - Max 50 accounts per request
 *   - Returns 400 for invalid addresses
 *   - Single DB query for efficiency
 */
export const POST = withLogging(async function POST(
  request: NextRequest
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("accounts" in body) ||
    !Array.isArray((body as { accounts: unknown }).accounts)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid required field: accounts (must be an array)" },
      { status: 400 }
    );
  }

  const { accounts } = body as { accounts: unknown[] };

  if (accounts.length > MAX_ACCOUNTS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ACCOUNTS} accounts allowed per request` },
      { status: 400 }
    );
  }

  for (const account of accounts) {
    if (typeof account !== "string" || !STELLAR_ADDRESS_RE.test(account)) {
      return NextResponse.json(
        { error: `Invalid Stellar address: ${String(account)}` },
        { status: 400 }
      );
    }
  }

  const typedAccounts = accounts as string[];

  if (typedAccounts.length === 0) {
    return NextResponse.json({ summaries: [] });
  }

  const network = parseNetwork(
    request.nextUrl.searchParams.get("network") || undefined
  );

  try {
    const summaries = getBatchGiveSummaries(typedAccounts, network);

    return NextResponse.json({ summaries });
  } catch (error) {
    console.error("Error executing batch give summaries query:", error);
    return NextResponse.json(
      { error: "Failed to query batch give summaries" },
      { status: 500 }
    );
  }
});
