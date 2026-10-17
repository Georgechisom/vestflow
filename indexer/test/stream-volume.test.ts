import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `vestflow-volume-${process.pid}-${Date.now()}-`),
);
const dbPath = path.join(tempDir, "testnet.db");
process.env.INDEXER_DB_PATH_TESTNET = dbPath;

const { getDb, upsertStreamCycle } = await import("../src/db");
const { createServer } = await import("../src/server");

const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXS7Q2QVSBQZBCO7T3WHNM7GC";
const OTHER_TOKEN = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

const ACCOUNT_1 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const ACCOUNT_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ACCOUNT_3 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN2";

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

describe("GET /analytics/stream-volume (#1070)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const cycle = (
      account: string,
      token: string,
      ledger: number,
      daysAgo: number,
      amount: string,
    ) =>
      upsertStreamCycle(
        {
          account,
          token,
          cycle_end_ledger: ledger,
          cycle_end_timestamp: now - daysAgo * DAY,
          amount_received: amount,
        },
        "testnet",
      );

    // Inside the 7 day window: 1000 + 500 (ACCOUNT_1) + 250 (ACCOUNT_2).
    cycle(ACCOUNT_1, TOKEN, 100, 2, "1000");
    cycle(ACCOUNT_1, TOKEN, 101, 3, "500");
    cycle(ACCOUNT_2, TOKEN, 102, 6, "250");
    // Only inside the 30 day window.
    cycle(ACCOUNT_3, TOKEN, 103, 20, "4000");
    // Older than 30 days — must be excluded from both windows.
    cycle(ACCOUNT_1, TOKEN, 104, 40, "9999");
    // Different token — must not leak into the aggregate.
    cycle(ACCOUNT_1, OTHER_TOKEN, 105, 1, "8888");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = getDb("testnet");
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires a token query parameter", async () => {
    const res = await fetch(`${baseUrl}/analytics/stream-volume`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/token/);
  });

  it("rejects an unknown network", async () => {
    const res = await fetch(
      `${baseUrl}/analytics/stream-volume?token=${TOKEN}&network=devnet`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 7d and 30d volume plus stream counts", async () => {
    const res = await fetch(`${baseUrl}/analytics/stream-volume?token=${TOKEN}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual({
      volume_7d: "1750",
      volume_30d: "5750",
      stream_count_7d: 2,
      stream_count_30d: 3,
    });
  });

  it("advertises a 10 minute cache", async () => {
    const res = await fetch(`${baseUrl}/analytics/stream-volume?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=600");
  });

  it("returns zeroes for a token with no settlements", async () => {
    const res = await fetch(
      `${baseUrl}/analytics/stream-volume?token=${OTHER_TOKEN}`,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      volume_7d: "0",
      volume_30d: "0",
      stream_count_7d: 0,
      stream_count_30d: 0,
    });
  });
});
