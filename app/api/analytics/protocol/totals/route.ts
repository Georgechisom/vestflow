import { NextRequest, NextResponse } from "next/server";
import { getDripsProtocolTotals } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { getOrSetCache } from "@/lib/redisCache";
import { withLogging } from "@/lib/requestLogger";

const CACHE_TTL_SECONDS = 300; // 5 minutes, per acceptance criteria

export const GET = withLogging(async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const network = parseNetwork(searchParams.get("network") || undefined);

  try {
    const cacheKey = `analytics:protocol:totals:${network}`;
    const totals = await getOrSetCache(cacheKey, CACHE_TTL_SECONDS, async () =>
      getDripsProtocolTotals(network),
    );

    return NextResponse.json(totals, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Error fetching protocol totals analytics:", error);
    return NextResponse.json({ error: "Failed to fetch protocol totals analytics" }, { status: 500 });
  }
});
