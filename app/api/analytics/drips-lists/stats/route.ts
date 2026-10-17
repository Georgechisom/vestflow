import { NextRequest, NextResponse } from "next/server";
import { queryDripsListsStats } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { createIpBasedRateLimiter } from "@/lib/rateLimit";
import { withLogging } from "@/lib/requestLogger";

const rateLimiter = createIpBasedRateLimiter(60_000, 60);

/** In-process cache entry so the 5-minute TTL is honoured even without Redis. */
interface CacheEntry {
  data: object;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/analytics/drips-lists/stats
 *
 * Returns a quick ecosystem overview of the drips list system:
 *   { total_lists, active_lists, frozen_lists, total_members, total_funded_lists }
 *
 * Definitions:
 *   - active_lists:  lists where total_funding_rate_per_sec > 0
 *   - frozen_lists:  lists where total_funding_rate_per_sec = 0
 *   - total_funded_lists: lists with a non-zero target_rate_per_sec set by owner
 *   - total_members: sum of current (non-departed) members across all lists
 *
 * Cached for 5 minutes. Returns zeroes on an empty database.
 *
 * Query params:
 *   - network  testnet | mainnet
 */
export const GET = withLogging(async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  const rateLimitResponse = await rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const network = parseNetwork(
    request.nextUrl.searchParams.get("network") || undefined,
  );

  const cacheKey = `drips-lists-stats:${network}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
        "X-Cache": "HIT",
      },
    });
  }

  try {
    const stats = queryDripsListsStats(network);

    cache.set(cacheKey, { data: stats, expiresAt: now + CACHE_TTL_MS });

    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Error in GET /analytics/drips-lists/stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
