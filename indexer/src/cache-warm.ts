import { getProtocolTotals, queryTopReceivers } from "./db";
import { cacheKey, cacheGet, cacheSet } from "./analytics-cache";
import type { NetworkName } from "./config";

const NETWORKS: NetworkName[] = ["mainnet", "testnet"];
const TOP_RECEIVER_LIMIT = 10;
const NATIVE_TOKEN = "XLM";

function warmNetwork(network: NetworkName): void {
  const totalsKey = cacheKey(`protocol-totals:${network}`, "all", "current", false);
  if (!cacheGet(totalsKey)) {
    const totals = getProtocolTotals(network);
    cacheSet(totalsKey, totals, "current");
  }

  const receiversKey = cacheKey(
    `top-receivers:${network}:${NATIVE_TOKEN}`,
    String(TOP_RECEIVER_LIMIT),
    "current",
    false,
  );
  if (!cacheGet(receiversKey)) {
    const receivers = queryTopReceivers(NATIVE_TOKEN, TOP_RECEIVER_LIMIT, network);
    cacheSet(receiversKey, receivers, "current");
  }
}

/**
 * Proactively populate the analytics cache on server startup so the first
 * real request hits a warm cache instead of incurring a cold-query penalty.
 * Runs non-blocking via setImmediate; errors are logged, never re-thrown.
 */
export function warmAnalyticsCache(): void {
  setImmediate(() => {
    for (const network of NETWORKS) {
      try {
        warmNetwork(network);
      } catch (err) {
        console.error(`[cacheWarm] failed to warm ${network}:`, err);
      }
    }
    console.log("[cacheWarm] analytics cache warmed");
  });
}
