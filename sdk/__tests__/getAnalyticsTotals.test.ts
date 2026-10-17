import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VestflowClient } from "../src/client";
import type { ProtocolTotals } from "../src/types";

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getAnalyticsTotals (#1091)", () => {
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

  it("returns typed totals when database is populated", async () => {
    const mockPayload: ProtocolTotals = {
      total_created: "50000000000",
      total_claimed: "15000000000",
      total_revoked_unvested: "5000000000",
      total_value_locked: "30000000000",
      active_schedules: 12,
    };

    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => mockPayload,
    });

    const totals = await client.getAnalyticsTotals();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/analytics/protocol/totals?network=testnet"
    );
    expect(totals).toEqual(mockPayload);
    expect(totals.total_created).toBe("50000000000");
    expect(totals.total_claimed).toBe("15000000000");
    expect(totals.total_revoked_unvested).toBe("5000000000");
    expect(totals.total_value_locked).toBe("30000000000");
    expect(totals.active_schedules).toBe(12);
  });

  it("returns zeroed totals on an empty database", async () => {
    const emptyPayload = {
      total_created: "0",
      total_claimed: "0",
      total_revoked_unvested: "0",
      total_value_locked: "0",
      active_schedules: 0,
    };

    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => emptyPayload,
    });

    const totals = await client.getAnalyticsTotals();

    expect(totals).toEqual({
      total_created: "0",
      total_claimed: "0",
      total_revoked_unvested: "0",
      total_value_locked: "0",
      active_schedules: 0,
    });
  });

  it("handles 404 gracefully by returning zeroed totals", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    const totals = await client.getAnalyticsTotals();
    expect(totals).toEqual({
      total_created: "0",
      total_claimed: "0",
      total_revoked_unvested: "0",
      total_value_locked: "0",
      active_schedules: 0,
    });
  });

  it("throws when the indexer returns a 500 error", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Server Error" }),
    });

    await expect(client.getAnalyticsTotals()).rejects.toThrow(
      /Failed to fetch protocol totals: 500/
    );
  });
});
