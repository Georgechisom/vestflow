import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `vestflow-split-receiver-${process.pid}-${Date.now()}-`),
);
const dbPath = path.join(tempDir, "testnet.db");
process.env.INDEXER_DB_PATH_TESTNET = dbPath;

const { getDb } = await import("../src/db");
const { createServer } = await import("../src/server");

const RECEIVER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBYM2";
const ABSENT = "GDQYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZZ";

const ACCOUNT_1 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const ACCOUNT_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ACCOUNT_3 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN2";

describe("GET /splits/by-receiver/:address (#1071)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const db = getDb("testnet");
    const insert = db.prepare(
      `INSERT INTO current_streams (account, token, receivers_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    );

    // Explicit basis-point weights.
    insert.run(
      ACCOUNT_1,
      "TOKEN_A",
      JSON.stringify([
        { receiver: RECEIVER, weight_bps: 6000 },
        { receiver: OTHER, weight_bps: 4000 },
      ]),
      1000,
    );
    // Same account, second token, fresher config wins the de-dupe.
    insert.run(
      ACCOUNT_1,
      "TOKEN_B",
      JSON.stringify([{ receiver: RECEIVER, weight_bps: 5000 }]),
      2000,
    );
    // No explicit weights — derive from per-receiver streaming rates.
    insert.run(
      ACCOUNT_2,
      "TOKEN_A",
      JSON.stringify({
        receivers: [
          { receiver: RECEIVER, rate_per_second: "3" },
          { receiver: OTHER, rate_per_second: "1" },
        ],
      }),
      1500,
    );
    // Does not route to RECEIVER — excluded.
    insert.run(
      ACCOUNT_3,
      "TOKEN_A",
      JSON.stringify([{ receiver: OTHER, weight_bps: 10000 }]),
      1200,
    );
    // Older config for ACCOUNT_3 *did* route to RECEIVER, but the fresher
    // config above wins the de-dupe, so ACCOUNT_3 must stay excluded.
    insert.run(
      ACCOUNT_3,
      "TOKEN_B",
      JSON.stringify([{ receiver: RECEIVER, weight_bps: 10000 }]),
      100,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = getDb("testnet");
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns each account that routes to the receiver with weight and percentage", async () => {
    const res = await fetch(`${baseUrl}/splits/by-receiver/${RECEIVER}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.address).toBe(RECEIVER);
    expect(body.total).toBe(2);
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts).toEqual(
      expect.arrayContaining([
        { account: ACCOUNT_1, weight_bps: 5000, percentage: 50 },
        { account: ACCOUNT_2, weight_bps: 7500, percentage: 75 },
      ]),
    );
  });

  it("sorts accounts deterministically by account address", async () => {
    const res = await fetch(`${baseUrl}/splits/by-receiver/${RECEIVER}`);
    const body = await res.json();
    const accounts = body.accounts.map(
      (row: { account: string }) => row.account,
    );
    expect(accounts).toEqual([ACCOUNT_1, ACCOUNT_2]);
  });

  it("paginates with limit and offset", async () => {
    const first = await fetch(
      `${baseUrl}/splits/by-receiver/${RECEIVER}?limit=1&offset=0`,
    );
    const firstBody = await first.json();
    expect(firstBody.accounts).toHaveLength(1);
    expect(firstBody.limit).toBe(1);
    expect(firstBody.offset).toBe(0);
    expect(firstBody.has_more).toBe(true);

    const second = await fetch(
      `${baseUrl}/splits/by-receiver/${RECEIVER}?limit=1&offset=1`,
    );
    const secondBody = await second.json();
    expect(secondBody.accounts).toHaveLength(1);
    expect(secondBody.has_more).toBe(false);
    expect(secondBody.accounts[0].account).not.toBe(firstBody.accounts[0].account);
  });

  it("returns an empty array when no account routes to the address", async () => {
    const res = await fetch(`${baseUrl}/splits/by-receiver/${ABSENT}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.has_more).toBe(false);
  });

  it("rejects an invalid address", async () => {
    const res = await fetch(`${baseUrl}/splits/by-receiver/not-an-address`);
    expect(res.status).toBe(400);
  });
});
