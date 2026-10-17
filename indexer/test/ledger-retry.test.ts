import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEDGER_MAX_RETRIES,
  ledgerBackoffDelayMs,
  ledgerRetryDelays,
  processLedgerWithRetry,
} from "../src/ledger-retry";

describe("processLedgerWithRetry (#1069)", () => {
  beforeEach(() => {
    // The helper logs to warn/error on retries — silence for clean test output.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the value with a single attempt when the first try succeeds", async () => {
    const fn = vi.fn().mockResolvedValue(7);
    const sleeps: number[] = [];

    const result = await processLedgerWithRetry(42, fn, {
      doSleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe(7);
    expect(result.attempts).toBe(1);
    expect(result.skipped).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("retries with the 1s/2s/4s/8s/16s schedule and succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 4) throw new Error(`boom ${calls}`);
      return "ok";
    });

    const result = await processLedgerWithRetry(99, fn, {
      doSleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe("ok");
    expect(result.attempts).toBe(4);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("gives up after 5 retries (6 attempts) and returns a skipped result", async () => {
    const onRetry = vi.fn();
    const onPermanentFailure = vi.fn();
    const sleeps: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    const result = await processLedgerWithRetry(123, fn, {
      doSleep: async (ms) => {
        sleeps.push(ms);
      },
      onRetry,
      onPermanentFailure,
    });

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.attempts).toBe(LEDGER_MAX_RETRIES + 1);
    expect(result.error).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(LEDGER_MAX_RETRIES + 1);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(onRetry).toHaveBeenCalledTimes(5);
    expect(onPermanentFailure).toHaveBeenCalledTimes(1);
    expect(onPermanentFailure.mock.calls[0][1]).toBe(LEDGER_MAX_RETRIES + 1);
  });

  it("never throws even when every attempt fails", async () => {
    await expect(
      processLedgerWithRetry(
        1,
        () => {
          throw new Error("nope");
        },
        { doSleep: async () => {} },
      ),
    ).resolves.toMatchObject({ success: false, skipped: true });
  });

  it("computes an exponential backoff capped at 16s", () => {
    expect(ledgerBackoffDelayMs(0)).toBe(1000);
    expect(ledgerBackoffDelayMs(1)).toBe(2000);
    expect(ledgerBackoffDelayMs(2)).toBe(4000);
    expect(ledgerBackoffDelayMs(3)).toBe(8000);
    expect(ledgerBackoffDelayMs(4)).toBe(16000);
    expect(ledgerBackoffDelayMs(10)).toBe(16000);
  });

  it("exposes the default retry schedule", () => {
    expect(ledgerRetryDelays()).toEqual([1000, 2000, 4000, 8000, 16000]);
  });
});
