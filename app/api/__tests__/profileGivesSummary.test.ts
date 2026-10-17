import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGiveSummary = vi.fn();

vi.mock("@/indexer/src/db", () => ({
  getGiveSummary: (...args: unknown[]) => mockGetGiveSummary(...args),
}));

const VALID_ADDRESS = "GBZC6YRFWINCGYH6FFIK3VY4KF3WZJQR7CD3S5Y4GVNIKU5RM3JY7YEX";

function createMockRequest(address: string) {
  const url = new URL(`http://localhost:3000/api/profile/${address}/gives-summary`);
  return new NextRequest(url);
}

function createMockParams(address: string) {
  return { params: Promise.resolve({ address }) };
}

describe("Issue #1061: GET /profile/:address/gives-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid Stellar address", async () => {
    const { GET } = await import("../profile/[address]/gives-summary/route");
    const req = createMockRequest("invalid-addr");
    const res = await GET(req, createMockParams("invalid-addr"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid Stellar address");
  });

  it("returns all four fields with zeroes for account with no gives", async () => {
    mockGetGiveSummary.mockReturnValue({
      total_given: "0",
      total_received: "0",
      unique_senders: 0,
      unique_receivers: 0,
      give_count: 0,
      receive_count: 0,
    });

    const { GET } = await import("../profile/[address]/gives-summary/route");
    const req = createMockRequest(VALID_ADDRESS);
    const res = await GET(req, createMockParams(VALID_ADDRESS));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      sent_count: 0,
      received_count: 0,
      total_sent: "0",
      total_received: "0",
    });
  });

  it("returns computed stats from gives table for active account", async () => {
    const activeAddress = "GDGTPGHK7P76S6667WXB2H57V5NZQCG3WJQR7CD3S5Y4GVNIKU5RM3JY";
    mockGetGiveSummary.mockReturnValue({
      total_given: "1500000000",
      total_received: "750000000",
      unique_senders: 2,
      unique_receivers: 5,
      give_count: 8,
      receive_count: 3,
    });

    const { GET } = await import("../profile/[address]/gives-summary/route");
    const req = createMockRequest(activeAddress);
    const res = await GET(req, createMockParams(activeAddress));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      sent_count: 8,
      received_count: 3,
      total_sent: "1500000000",
      total_received: "750000000",
    });
  });

  it("sets Cache-Control header for 30s", async () => {
    mockGetGiveSummary.mockReturnValue({
      total_given: "0",
      total_received: "0",
      unique_senders: 0,
      unique_receivers: 0,
      give_count: 0,
      receive_count: 0,
    });

    const { GET } = await import("../profile/[address]/gives-summary/route");
    const req = createMockRequest(VALID_ADDRESS);
    const res = await GET(req, createMockParams(VALID_ADDRESS));

    expect(res.headers.get("Cache-Control")).toContain("max-age=30");
  });
});
