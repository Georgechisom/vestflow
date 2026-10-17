import { NextRequest, NextResponse } from "next/server";
import { queryTopGivers } from "@/indexer/src/db";
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
 * GET /api/analytics/gives/top-givers?token=C...
 *
 * Returns the top 20 addresses by total amount given for the requested
 * token across all time.
 *
 * Query params:
 *   - token    required – SAC address of the token
 *   - limit    integer 1–20, default 20
 *   - network  testnet | mainnet
 *
 * Response (cached for 5 minutes):
 *   {
 *     token:      string,
 *     givers:     Array<{ account, total_given, give_count }>,
 *     last_updated: number
 *   }
 */
export const GET = withLogging(async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  const rateLimitResponse = await rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { error: "Token parameter is required" },
      { status: 400 },
    );
  }

  const rawLimit = request.nextUrl.searchParams.get("limit");
  let limit = 20;
  if (rawLimit != null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      return NextResponse.json(
        { error: "limit must be an integer between 1 and 20" },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const network = parseNetwork(
    request.nextUrl.searchParams.get("network") || undefined,
  );

  const cacheKey = `top-givers:${network}:${token}:${limit}`;
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
    const givers = queryTopGivers(token, limit, network);

    const response = {
      token,
      givers,
      last_updated: Math.floor(now / 1000),
    };

    cache.set(cacheKey, { data: response, expiresAt: now + CACHE_TTL_MS });

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Error in GET /analytics/gives/top-givers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
