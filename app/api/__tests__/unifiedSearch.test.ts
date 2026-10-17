import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockUnifiedSearch = vi.fn();

vi.mock("@/indexer/src/db", () => ({
  unifiedSearch: (...args: unknown[]) => mockUnifiedSearch(...args),
}));

describe("Issue #1066: Unified Search endpoint GET /search?q=", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when query exceeds 100 characters", async () => {
    const { GET } = await import("../search/route");
    const longQuery = "a".repeat(101);
    const req = new NextRequest(`http://localhost:3000/api/search?q=${longQuery}`);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Query exceeds maximum length of 100 characters");
  });

  it("returns empty results gracefully when query is empty or whitespace", async () => {
    const { GET } = await import("../search/route");
    const req = new NextRequest("http://localhost:3000/api/search?q=%20%20");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
    expect(body.wallets).toEqual([]);
    expect(body.lists).toEqual([]);
    expect(body.transactions).toEqual([]);
  });

  it("returns results from all three categories labeled by type (wallet/list/tx)", async () => {
    mockUnifiedSearch.mockReturnValue({
      wallets: [
        { type: "wallet", address: "GBZC6YRFWINCGYH6FFIK3VY4KF3WZJQR7CD3S5Y4GVNIKU5RM3JY7YEX" },
      ],
      lists: [
        { type: "list", id: "list-1", name: "Stellar Devs", owner: "GOWNER", token: "CDREX" },
      ],
      txs: [
        { type: "tx", hash: "a1b2c3d4e5", id: "100-1-1", ledger: 100 },
      ],
      results: [
        { type: "wallet", address: "GBZC6YRFWINCGYH6FFIK3VY4KF3WZJQR7CD3S5Y4GVNIKU5RM3JY7YEX" },
        { type: "list", id: "list-1", name: "Stellar Devs", owner: "GOWNER", token: "CDREX" },
        { type: "tx", hash: "a1b2c3d4e5", id: "100-1-1", ledger: 100 },
      ],
    });

    const { GET } = await import("../search/route");
    const req = new NextRequest("http://localhost:3000/api/search?q=Stellar");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.query).toBe("Stellar");
    expect(body.results).toHaveLength(3);

    // Results labeled by type
    expect(body.results[0].type).toBe("wallet");
    expect(body.results[1].type).toBe("list");
    expect(body.results[2].type).toBe("tx");

    expect(body.wallets).toHaveLength(1);
    expect(body.lists).toHaveLength(1);
    expect(body.transactions).toHaveLength(1);
  });

  it("handles empty results per category gracefully", async () => {
    mockUnifiedSearch.mockReturnValue({
      wallets: [],
      lists: [
        { type: "list", id: "list-only", name: "Ecosystem Fund", owner: "GOWNER", token: "CDREX" },
      ],
      txs: [],
      results: [
        { type: "list", id: "list-only", name: "Ecosystem Fund", owner: "GOWNER", token: "CDREX" },
      ],
    });

    const { GET } = await import("../search/route");
    const req = new NextRequest("http://localhost:3000/api/search?q=Ecosystem");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.wallets).toEqual([]);
    expect(body.transactions).toEqual([]);
    expect(body.lists).toHaveLength(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].type).toBe("list");
  });
});
