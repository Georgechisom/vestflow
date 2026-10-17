import { NextRequest, NextResponse } from "next/server";
import { getActiveWalletsCount } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { getOrSetCache } from "@/lib/redisCache";
import { withLogging } from "@/lib/requestLogger";

const CACHE_TTL_SECONDS = 600; // 10 minutes, per acceptance criteria
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export const GET = withLogging(async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const requestedDays = Number(searchParams.get("days"));
  const days = Number.isFinite(requestedDays) && requestedDays > 0
    ? Math.min(requestedDays, MAX_DAYS)
    : DEFAULT_DAYS;
  const network = parseNetwork(searchParams.get("network") || undefined);

  try {
    const cacheKey = `analytics:active-wallets:${network}:${days}`;
    const count = await getOrSetCache(cacheKey, CACHE_TTL_SECONDS, async () =>
      getActiveWalletsCount(days, network),
    );

    return NextResponse.json(
      { days, active_wallets: count },
      { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("Error fetching active wallets analytics:", error);
    return NextResponse.json({ error: "Failed to fetch active wallets analytics" }, { status: 500 });
  }
});
