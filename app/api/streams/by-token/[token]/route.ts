import { NextRequest, NextResponse } from "next/server";
import { queryActiveStreamsByToken } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";
import { createIpBasedRateLimiter } from "@/lib/rateLimit";
import { withLogging } from "@/lib/requestLogger";

const rateLimiter = createIpBasedRateLimiter(60_000, 60);

/**
 * GET /api/streams/by-token/:token
 *
 * Returns all currently active (rate > 0) streams for the given token
 * across all senders, sorted by rate descending. Cursor-paginated.
 *
 * Query params:
 *   - limit   integer 1–100, default 20
 *   - cursor  opaque pagination cursor from previous response
 *   - network testnet | mainnet
 *
 * Response:
 *   {
 *     token:       string,
 *     streams:     Array<{ sender, receiver, rate, start_time, estimated_end_time }>,
 *     next_cursor: string | null
 *   }
 */
export const GET = withLogging(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const rateLimitResponse = await rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const { token } = await params;

  if (!token || token.trim() === "") {
    return NextResponse.json(
      { error: "token path parameter is required" },
      { status: 400 },
    );
  }

  const rawLimit = request.nextUrl.searchParams.get("limit");
  let limit = 20;
  if (rawLimit != null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: "limit must be an integer between 1 and 100" },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const network = parseNetwork(
    request.nextUrl.searchParams.get("network") || undefined,
  );

  try {
    const { items, nextCursor } = queryActiveStreamsByToken({
      token,
      limit,
      cursor,
      network,
    });

    const streams = items.map((s) => ({
      sender: s.sender,
      receiver: s.receiver,
      rate: s.rate_per_second,
      start_time: s.start_time,
      estimated_end_time: s.estimated_end_time,
    }));

    return NextResponse.json(
      { token, streams, next_cursor: nextCursor },
      {
        headers: {
          "Cache-Control": "public, max-age=15, stale-while-revalidate=30",
        },
      },
    );
  } catch (error) {
    console.error(`Error in GET /api/streams/by-token/${token}:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
