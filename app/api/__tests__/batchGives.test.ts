import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetBatchGiveSummaries = vi.fn();

vi.mock("@/indexer/src/db", () => ({
  getBatchGiveSummaries: (...args: unknown[]) => mockGetBatchGiveSummaries(...args),
}));

const VALID_ADDR_1 = "GBZC6YRFWINCGYH6FFIK3VY4KF3WZJQR7CD3S5Y4GVNIKU5RM3JY7YEX";
const VALID_ADDR_2 = "GDGTPGHK7P76S6667WXB2H57V5NZQCG3WJQR7CD3S5Y4GVNIKU5RM3JY";

function createMockPostRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/gives/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Issue #1067: POST /gives/batch bulk give analytics queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when body is invalid JSON or accounts is missing/not an array", async () => {
    const { POST } = await import("../gives/batch/route");
    const req = createMockPostRequest({ wrongField: [] });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Missing or invalid required field: accounts");
  });

  it("returns 400 when accounts exceeds 50", async () => {
    const { POST } = await import("../gives/batch/route");
    const accounts = Array.from({ length: 51 }, () => VALID_ADDR_1);
    const req = createMockPostRequest({ accounts });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Maximum 50 accounts allowed per request");
  });

  it("returns 400 for invalid addresses in accounts array", async () => {
    const { POST } = await import("../gives/batch/route");
    const req = createMockPostRequest({
      accounts: [VALID_ADDR_1, "not-a-stellar-address"],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid Stellar address");
  });

  it("returns give stats for all provided accounts using a single DB call", async () => {
    mockGetBatchGiveSummaries.mockReturnValue([
      {
        account: VALID_ADDR_1,
        sent_count: 5,
        received_count: 2,
        total_sent: "5000000",
        total_received: "2000000",
      },
      {
        account: VALID_ADDR_2,
        sent_count: 0,
        received_count: 0,
        total_sent: "0",
        total_received: "0",
      },
    ]);

    const { POST } = await import("../gives/batch/route");
    const req = createMockPostRequest({
      accounts: [VALID_ADDR_1, VALID_ADDR_2],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summaries).toHaveLength(2);
    expect(data.summaries[0]).toEqual({
      account: VALID_ADDR_1,
      sent_count: 5,
      received_count: 2,
      total_sent: "5000000",
      total_received: "2000000",
    });
    expect(data.summaries[1]).toEqual({
      account: VALID_ADDR_2,
      sent_count: 0,
      received_count: 0,
      total_sent: "0",
      total_received: "0",
    });

    // Verify single database query execution
    expect(mockGetBatchGiveSummaries).toHaveBeenCalledTimes(1);
    expect(mockGetBatchGiveSummaries).toHaveBeenCalledWith([VALID_ADDR_1, VALID_ADDR_2], "testnet");
  });

  it("handles empty accounts array gracefully", async () => {
    const { POST } = await import("../gives/batch/route");
    const req = createMockPostRequest({ accounts: [] });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summaries).toEqual([]);
    expect(mockGetBatchGiveSummaries).not.toHaveBeenCalled();
  });
});
