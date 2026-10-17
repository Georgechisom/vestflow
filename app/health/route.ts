import { NextResponse } from "next/server";
import { getDb, getCheckpoint } from "@/indexer/src/db";
import { parseNetwork } from "@/indexer/src/config";

const NETWORK = parseNetwork(process.env.NEXT_PUBLIC_NETWORK);
const RPC_URL =
  process.env.NEXT_PUBLIC_NETWORK === "mainnet"
    ? "https://mainnet.sorobanrpc.com"
    : "https://soroban-testnet.stellar.org";

const RPC_TIMEOUT_MS = 2000;

/**
 * Stellar ledgers close on a ~5 second cadence, so the ledger lag is
 * converted to "seconds behind chain tip". Lag over {@link DEGRADED_LAG_SECONDS}
 * marks the indexer degraded (#1068).
 */
const LEDGER_CLOSE_INTERVAL_SECONDS = 5;
const DEGRADED_LAG_SECONDS = 60;

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  let dbConnected = false;
  let rpcConnected = false;
  let indexerLagLedgers = 0;

  // DB check — synchronous, fast
  try {
    const db = getDb(NETWORK);
    db.prepare("SELECT 1").get();
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  // RPC check — async with timeout to stay under 500ms budget
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    const { rpc: StellarRpc } = await import("@stellar/stellar-sdk");
    const server = new StellarRpc.Server(RPC_URL);
    const latestLedger = await server.getLatestLedger();
    clearTimeout(timeout);

    rpcConnected = true;

    // Calculate indexer lag
    const checkpoint = getCheckpoint(NETWORK);
    indexerLagLedgers = Math.max(0, latestLedger.sequence - checkpoint);
  } catch {
    rpcConnected = false;
  }

  // Convert ledger lag to "seconds behind chain tip" (#1068). A lag over
  // DEGRADED_LAG_SECONDS marks the indexer degraded even when the DB and RPC
  // probes both succeed.
  const indexerLagSeconds = indexerLagLedgers * LEDGER_CLOSE_INTERVAL_SECONDS;
  const isHealthy =
    dbConnected &&
    rpcConnected &&
    indexerLagSeconds <= DEGRADED_LAG_SECONDS;
  const status = isHealthy ? "healthy" : "degraded";

  return NextResponse.json(
    {
      status,
      indexer_lag_seconds: indexerLagSeconds,
      indexer_lag_ledgers: indexerLagLedgers,
      rpc_connected: rpcConnected,
      db_connected: dbConnected,
    },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
