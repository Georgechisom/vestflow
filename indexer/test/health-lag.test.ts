import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { _clearTestDb, _setTestDb } from "../src/db";
import { resetMetrics } from "../src/metrics";
import { createServer } from "../src/server";

/**
 * #1068 — GET /health exposes `indexer_lag_seconds` and flips to
 * `status: "degraded"` once the indexer is more than 60 seconds behind
 * the chain tip.
 *
 * Lag is forced via the `INDEXER_LATEST_LEDGER` override that the metrics
 * module already honours, so no live RPC is needed.
 */
describe("GET /health indexer lag (#1068)", () => {
  let db: Database.Database;
  let server: http.Server;
  let baseUrl: string;
  let previousLatestLedger: string | undefined;

  beforeEach(async () => {
    previousLatestLedger = process.env.INDEXER_LATEST_LEDGER;
    resetMetrics();

    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE checkpoint (id INTEGER PRIMARY KEY, last_ledger INTEGER NOT NULL);
      INSERT INTO checkpoint (id, last_ledger) VALUES (1, 100);
    `);
    _setTestDb("testnet", db);

    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    _clearTestDb("testnet");
    db.close();
    resetMetrics();
    if (previousLatestLedger === undefined) {
      delete process.env.INDEXER_LATEST_LEDGER;
    } else {
      process.env.INDEXER_LATEST_LEDGER = previousLatestLedger;
    }
  });

  it("reports healthy when the lag is within 60 seconds", async () => {
    process.env.INDEXER_LATEST_LEDGER = "110"; // 10 ledgers * 5s = 50s

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.ok).toBe(true);
    expect(body.indexer_lag_seconds).toBe(50);
    expect(body.checkpoint).toBe(100);
  });

  it("treats exactly 60 seconds of lag as healthy", async () => {
    process.env.INDEXER_LATEST_LEDGER = "112"; // 12 ledgers * 5s = 60s

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.indexer_lag_seconds).toBe(60);
  });

  it("reports degraded with 503 once the lag exceeds 60 seconds", async () => {
    process.env.INDEXER_LATEST_LEDGER = "125"; // 25 ledgers * 5s = 125s

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.ok).toBe(false);
    expect(body.indexer_lag_seconds).toBe(125);
  });
});
