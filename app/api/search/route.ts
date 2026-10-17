import { NextRequest, NextResponse } from "next/server";
import { unifiedSearch } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { withLogging } from "@/lib/requestLogger";

const MAX_QUERY_LENGTH = 100;

/**
 * GET /api/search?q=
 *
 * Unified search endpoint returning results from:
 *   - wallets (address match)
 *   - drips lists (name match)
 *   - transactions (hash prefix match)
 *
 * Up to 5 results per category.
 * Results labeled by type (wallet/list/tx).
 * Max query length 100 chars.
 */
export const GET = withLogging(async function GET(
  request: NextRequest
): Promise<NextResponse> {
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";

  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: "Query exceeds maximum length of 100 characters" },
      { status: 400 }
    );
  }

  const query = rawQuery.trim();
  if (!query) {
    return NextResponse.json({
      query: "",
      results: [],
      wallets: [],
      lists: [],
      transactions: [],
    });
  }

  const network = parseNetwork(
    request.nextUrl.searchParams.get("network") || undefined
  );

  try {
    const searchData = unifiedSearch(query, network);

    return NextResponse.json({
      query,
      results: searchData.results,
      wallets: searchData.wallets,
      lists: searchData.lists,
      transactions: searchData.txs,
    });
  } catch (error) {
    console.error("Error during unified search:", error);
    return NextResponse.json(
      { error: "Search query failed" },
      { status: 500 }
    );
  }
});
