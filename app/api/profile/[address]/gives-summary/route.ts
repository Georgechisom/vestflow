import { NextRequest, NextResponse } from "next/server";
import { getGiveSummary } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { withLogging } from "@/lib/requestLogger";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

interface CacheEntry {
  data: {
    sent_count: number;
    received_count: number;
    total_sent: string;
    total_received: string;
  };
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * GET /api/profile/:address/gives-summary
 *
 * Returns quick give stats for an address:
 *   { sent_count, received_count, total_sent, total_received }
 *
 * Computed from the indexed gives table.
 * Returns zeroes for accounts with no gives.
 * Cached for 30 seconds.
 */
export const GET = withLogging(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
): Promise<NextResponse> {
  try {
    const { address } = await params;

    if (!address || !STELLAR_ADDRESS_RE.test(address)) {
      return NextResponse.json(
        { error: "Invalid Stellar address" },
        { status: 400 }
      );
    }

    const network = parseNetwork(
      request.nextUrl.searchParams.get("network") || undefined
    );

    const cacheKey = `${network}:${address}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
          "X-Cache": "HIT",
        },
      });
    }

    const summary = getGiveSummary(address, network);

    const result = {
      sent_count: summary.give_count,
      received_count: summary.receive_count,
      total_sent: summary.total_given,
      total_received: summary.total_received,
    };

    cache.set(cacheKey, {
      data: result,
      expiresAt: now + CACHE_TTL_MS,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Error fetching gives summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch gives summary" },
      { status: 500 }
    );
  }
});
