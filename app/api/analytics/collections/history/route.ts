import { NextRequest, NextResponse } from "next/server";
import { getCollectHistoryByDay } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { getOrSetCache } from "@/lib/redisCache";
import { withLogging } from "@/lib/requestLogger";

const CACHE_TTL_SECONDS = 300; // 5 minutes, per acceptance criteria

export const GET = withLogging(async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const account = searchParams.get("account") || undefined;
  const token = searchParams.get("token") || undefined;
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
