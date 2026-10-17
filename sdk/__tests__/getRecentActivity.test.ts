import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VestflowClient } from "../src/client";
import type { ActivityEvent } from "../src/types";

const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const COUNTERPARTY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getRecentActivity (#1089)", () => {
  let client: VestflowClient;

  beforeEach(() => {
    vi.unstubAllGlobals();
    client = new VestflowClient({
      network: "testnet",
      indexerUrl: "http://127.0.0.1:3001",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns typed event list when account has activity", async () => {
    const rawEvents: ActivityEvent[] = [
      {
        type: "given",
        counterparty: COUNTERPARTY,
        token: TOKEN,
        amount: "10000000",
        timestamp: 1700000000,
      },
      {
        type: "claimed",
        counterparty: COUNTERPARTY,
        token: TOKEN,
        amount: "5000000",
        timestamp: 1700003600,
      },
    ];

    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ events: rawEvents }),
    });

    const activity = await client.getRecentActivity(ACCOUNT);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/profile/${ACCOUNT}/recent-activity?network=testnet`
    );
    expect(activity).toHaveLength(2);
    expect(activity[0]).toEqual({
      type: "given",
      counterparty: COUNTERPARTY,
      token: TOKEN,
      amount: "10000000",
      timestamp: 1700000000,
    });
    // Explicit checks for required event properties
    expect(activity[0]).toHaveProperty("type", "given");
    expect(activity[0]).toHaveProperty("counterparty", COUNTERPARTY);
    expect(activity[0]).toHaveProperty("token", TOKEN);
    expect(activity[0]).toHaveProperty("amount", "10000000");
    expect(activity[0]).toHaveProperty("timestamp", 1700000000);
  });

  it("returns empty array for new/inactive wallets (404 status)", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Wallet not found" }),
    });

    const activity = await client.getRecentActivity(ACCOUNT);
    expect(activity).toEqual([]);
  });

  it("returns empty array when events array is empty", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ events: [] }),
    });

    const activity = await client.getRecentActivity(ACCOUNT);
    expect(activity).toEqual([]);
  });

  it("passes options to query string (limit, offset, cursor, token)", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ events: [] }),
    });

    await client.getRecentActivity(ACCOUNT, {
      limit: 10,
      offset: 20,
      cursor: "cur123",
      token: TOKEN,
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    const parsed = new URL(calledUrl);
    expect(parsed.searchParams.get("network")).toBe("testnet");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("offset")).toBe("20");
    expect(parsed.searchParams.get("cursor")).toBe("cur123");
    expect(parsed.searchParams.get("token")).toBe(TOKEN);
  });

  it("throws TypeError when an invalid address is provided", async () => {
    await expect(client.getRecentActivity("invalid-address")).rejects.toThrow(
      TypeError
    );
    await expect(client.getRecentActivity("invalid-address")).rejects.toThrow(
      /Invalid Stellar address/
    );
  });

  it("throws Error on 500 server error", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Server Error" }),
    });

    await expect(client.getRecentActivity(ACCOUNT)).rejects.toThrow(
      /Failed to fetch recent activity/
    );
  });
});
