import { StrKey } from "@stellar/stellar-sdk";
import { NextRequest, NextResponse } from "next/server";
import { getCollectHistoryByDay } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { getOrSetCache } from "@/lib/redisCache";
import { withLogging } from "@/lib/requestLogger";
import { isValidStellarAddress } from "@/lib/stellar-verify";

const CACHE_TTL_SECONDS = 300; // 5 minutes, per acceptance criteria

export const GET = withLogging(async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  // Validate before use in both the SQL filter and the cache key — an
  // unvalidated value here could otherwise collide with another request's
  // cache key (e.g. a value containing ":").
  const rawAccount = searchParams.get("account");
  const account = rawAccount && isValidStellarAddress(rawAccount) ? rawAccount : undefined;
  const rawToken = searchParams.get("token");
  const token = rawToken && StrKey.isValidContract(rawToken) ? rawToken : undefined;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const network = parseNetwork(searchParams.get("network") || undefined);

  try {
    const cacheKey = `analytics:collections:history:${network}:${account ?? "-"}:${token ?? "-"}:${from ?? "-"}:${to ?? "-"}`;
    const days = await getOrSetCache(cacheKey, CACHE_TTL_SECONDS, async () =>
      getCollectHistoryByDay({ account, token, from, to, network }),
    );

    return NextResponse.json(days, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Error fetching collection history analytics:", error);
    return NextResponse.json({ error: "Failed to fetch collection history analytics" }, { status: 500 });
  }
});
