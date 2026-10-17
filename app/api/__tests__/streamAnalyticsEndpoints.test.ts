// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Shared mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/rateLimit", () => ({
  createIpBasedRateLimiter: () => async () => null, // never rate-limits in tests
}));

vi.mock("@/lib/requestLogger", () => ({
  withLogging: (fn: unknown) => fn,
}));

vi.mock("@/indexer/src/config", () => ({
  parseNetwork: (v?: string) => v ?? "testnet",
}));

vi.mock("@/indexer/src/db", async () => {
  const actual = await vi.importActual<typeof import("@/indexer/src/db")>(
    "@/indexer/src/db",
  );
  return {
    ...actual,
    queryActiveStreamsByToken: vi.fn(),
    queryClosedStreamsBySender: vi.fn(),
    queryTopGivers: vi.fn(),
    queryDripsListsStats: vi.fn(),
  };
});

import {
  queryActiveStreamsByToken,
  queryClosedStreamsBySender,
  queryTopGivers,
  queryDripsListsStats,
} from "@/indexer/src/db";

import { GET as getStreamsByToken } from "../streams/by-token/[token]/route";
import { GET as getClosedStreams } from "../streams/closed/[address]/route";
import { GET as getTopGivers } from "../analytics/gives/top-givers/route";
import { GET as getDripsListsStats } from "../analytics/drips-lists/stats/route";

// ── Helper ────────────────────────────────────────────────────────────

function makeRequest(path: string, search: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

// ── #1062 GET /api/streams/by-token/[token] ──────────────────────────

describe("GET /api/streams/by-token/:token", () => {
  const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  beforeEach(() => {
    vi.mocked(queryActiveStreamsByToken).mockReturnValue({
      items: [
        {
          id: "s1",
          sender: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
          receiver: "GBSOV3F63VBMLDKD3JV5HQC5KPVXJQEQHP5TPUMZWNMCZZQ6SKF2OL3A",
          rate_per_second: "1000",
          start_time: 1700000000,
          estimated_end_time: null,
        },
      ],
      nextCursor: null,
    });
  });

  it("returns active streams for a token", async () => {
    const req = makeRequest(`/api/streams/by-token/${TOKEN}`);
    const res = await getStreamsByToken(req, {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(TOKEN);
    expect(body.streams).toHaveLength(1);
    expect(body.streams[0]).toMatchObject({
      sender: expect.any(String),
      receiver: expect.any(String),
      rate: "1000",
      start_time: 1700000000,
    });
    expect(body.next_cursor).toBeNull();
  });

  it("returns empty list when no active streams", async () => {
    vi.mocked(queryActiveStreamsByToken).mockReturnValue({
      items: [],
      nextCursor: null,
    });
    const req = makeRequest(`/api/streams/by-token/${TOKEN}`);
    const res = await getStreamsByToken(req, {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.streams).toEqual([]);
  });

  it("rejects limit out of range", async () => {
    const req = makeRequest(`/api/streams/by-token/${TOKEN}`, { limit: "999" });
    const res = await getStreamsByToken(req, {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(400);
  });

  it("forwards cursor to db query", async () => {
    const req = makeRequest(`/api/streams/by-token/${TOKEN}`, {
      cursor: "abc",
      limit: "5",
    });
    await getStreamsByToken(req, {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(queryActiveStreamsByToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, limit: 5, cursor: "abc" }),
    );
  });
});

// ── #1064 GET /api/streams/closed/[address] ──────────────────────────

describe("GET /api/streams/closed/:address", () => {
  const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  beforeEach(() => {
    vi.mocked(queryClosedStreamsBySender).mockReturnValue({
      items: [
        {
          receiver: "GBSOV3F63VBMLDKD3JV5HQC5KPVXJQEQHP5TPUMZWNMCZZQ6SKF2OL3A",
          token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          close_time: 1701000000,
          total_streamed: "8640000000",
        },
      ],
      nextCursor: null,
    });
  });

  it("returns closed streams for a sender", async () => {
    const req = makeRequest(`/api/streams/closed/${ADDRESS}`);
    const res = await getClosedStreams(req, {
      params: Promise.resolve({ address: ADDRESS }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(ADDRESS);
    expect(body.streams).toHaveLength(1);
    expect(body.streams[0]).toMatchObject({
      receiver: expect.any(String),
      token: expect.any(String),
      close_time: 1701000000,
      total_streamed: "8640000000",
    });
    expect(body.next_cursor).toBeNull();
  });

  it("returns 400 for invalid Stellar address", async () => {
    const req = makeRequest(`/api/streams/closed/not-an-address`);
    const res = await getClosedStreams(req, {
      params: Promise.resolve({ address: "not-an-address" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid cursor", async () => {
    vi.mocked(queryClosedStreamsBySender).mockReturnValue(null);
    const req = makeRequest(`/api/streams/closed/${ADDRESS}`, {
      cursor: "invalid-cursor",
    });
    const res = await getClosedStreams(req, {
      params: Promise.resolve({ address: ADDRESS }),
    });
    expect(res.status).toBe(400);
  });

  it("returns empty list for address with no closed streams", async () => {
    vi.mocked(queryClosedStreamsBySender).mockReturnValue({
      items: [],
      nextCursor: null,
    });
    const req = makeRequest(`/api/streams/closed/${ADDRESS}`);
    const res = await getClosedStreams(req, {
      params: Promise.resolve({ address: ADDRESS }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.streams).toEqual([]);
  });

  it("is sorted by close_time descending by DB contract", async () => {
    vi.mocked(queryClosedStreamsBySender).mockReturnValue({
      items: [
        {
          receiver: "G" + "B".repeat(55),
          token: "C" + "D".repeat(55),
          close_time: 1702000000,
          total_streamed: "1000",
        },
        {
          receiver: "G" + "C".repeat(55),
          token: "C" + "D".repeat(55),
          close_time: 1701000000,
          total_streamed: "500",
        },
      ],
      nextCursor: null,
    });
    const req = makeRequest(`/api/streams/closed/${ADDRESS}`);
    const res = await getClosedStreams(req, {
      params: Promise.resolve({ address: ADDRESS }),
    });
    const body = await res.json();
    expect(body.streams[0].close_time).toBeGreaterThan(body.streams[1].close_time);
  });
});

// ── #1063 GET /api/analytics/gives/top-givers ────────────────────────

describe("GET /api/analytics/gives/top-givers", () => {
  const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  beforeEach(() => {
    vi.mocked(queryTopGivers).mockReturnValue([
      {
        account: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        total_given: "5000000000",
        give_count: 10,
      },
    ]);
  });

  it("returns top givers for a token", async () => {
    const req = makeRequest("/api/analytics/gives/top-givers", { token: TOKEN });
    const res = await getTopGivers(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(TOKEN);
    expect(body.givers).toHaveLength(1);
    expect(body.givers[0]).toMatchObject({
      account: expect.any(String),
      total_given: "5000000000",
      give_count: 10,
    });
    expect(body.last_updated).toBeTypeOf("number");
  });

  it("returns 400 when token is missing", async () => {
    const req = makeRequest("/api/analytics/gives/top-givers");
    const res = await getTopGivers(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit > 20", async () => {
    const req = makeRequest("/api/analytics/gives/top-givers", {
      token: TOKEN,
      limit: "25",
    });
    const res = await getTopGivers(req);
    expect(res.status).toBe(400);
  });

  it("returns empty givers array when no gives recorded", async () => {
    vi.mocked(queryTopGivers).mockReturnValue([]);
    const req = makeRequest("/api/analytics/gives/top-givers", { token: TOKEN });
    const res = await getTopGivers(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.givers).toEqual([]);
  });

  it("includes Cache-Control header for 5-minute caching", async () => {
    const req = makeRequest("/api/analytics/gives/top-givers", { token: TOKEN });
    const res = await getTopGivers(req);
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });
});

// ── #1065 GET /api/analytics/drips-lists/stats ───────────────────────

describe("GET /api/analytics/drips-lists/stats", () => {
  beforeEach(() => {
    vi.mocked(queryDripsListsStats).mockReturnValue({
      total_lists: 42,
      active_lists: 30,
      frozen_lists: 12,
      total_members: 150,
      total_funded_lists: 25,
    });
  });

  it("returns all five required fields", async () => {
    const req = makeRequest("/api/analytics/drips-lists/stats");
    const res = await getDripsListsStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      total_lists: 42,
      active_lists: 30,
      frozen_lists: 12,
      total_members: 150,
      total_funded_lists: 25,
    });
  });

  it("returns zeroes on empty database", async () => {
    vi.mocked(queryDripsListsStats).mockReturnValue({
      total_lists: 0,
      active_lists: 0,
      frozen_lists: 0,
      total_members: 0,
      total_funded_lists: 0,
    });
    const req = makeRequest("/api/analytics/drips-lists/stats");
    const res = await getDripsListsStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_lists).toBe(0);
    expect(body.active_lists).toBe(0);
    expect(body.frozen_lists).toBe(0);
    expect(body.total_members).toBe(0);
    expect(body.total_funded_lists).toBe(0);
  });

  it("includes Cache-Control header for 5-minute caching", async () => {
    const req = makeRequest("/api/analytics/drips-lists/stats");
    const res = await getDripsListsStats(req);
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });
});
