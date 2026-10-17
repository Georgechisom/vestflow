import { describe, it, expect } from "vitest";
import { formatRate } from "../src/utils";

describe("formatRate (#683)", () => {
  it("formats a zero rate", () => {
    expect(formatRate(0n, "XLM", 7)).toBe("0 XLM / day");
  });

  it("formats a sub-second-scale rate at 'sec' granularity", () => {
    // 115 stroops/sec is already meaningful per second — no need to escalate.
    expect(formatRate(115n, "XLM", 7)).toBe("0.000011 XLM / sec");
  });

  it("derives a per-second rate from a monthly total (30-day month)", () => {
    // 3 000 XLM per 30-day month, expressed as a per-second stroop rate.
    const monthlyStroops = 3_000n * 10_000_000n;
    const amtPerSec = monthlyStroops / (30n * 86_400n);
    expect(formatRate(amtPerSec, "XLM", 7)).toBe("0.001157 XLM / sec");
  });

  it("escalates to 'min' when the per-second value truncates to zero", () => {
    expect(formatRate(1n, "XLM", 7)).toBe("0.000006 XLM / min");
  });

  it("escalates to 'hour' when sec and min both truncate to zero", () => {
    expect(formatRate(1n, "TOK", 9)).toBe("0.000003 TOK / hour");
  });

  it("escalates to 'day' when sec, min, and hour all truncate to zero", () => {
    expect(formatRate(1n, "TOK", 10)).toBe("0.000008 TOK / day");
  });

  it("falls back to '0 TOKEN / day' when the rate is negligible at every unit", () => {
    expect(formatRate(1n, "TOK", 18)).toBe("0 TOK / day");
  });

  it("uses plain integer formatting when decimals is 0", () => {
    expect(formatRate(5n, "PTS", 0)).toBe("5 PTS / sec");
  });

  it("throws on a negative rate", () => {
    expect(() => formatRate(-1n, "XLM", 7)).toThrow(/negative/);
  });

  it("throws on invalid decimals", () => {
    expect(() => formatRate(1n, "XLM", -1)).toThrow(/decimals/);
  });
});

describe("formatRate with periods (#1090)", () => {
  it("formats zero rate for each period", () => {
    expect(formatRate(0n, "second")).toBe("0 XLM/second");
    expect(formatRate(0n, "day")).toBe("0 XLM/day");
    expect(formatRate(0n, "month")).toBe("0 XLM/month");
    expect(formatRate(0n, "year")).toBe("0 XLM/year");
  });

  it("formats second period with multiplier 1", () => {
    // 1 stroop per second with 7 decimals = 0.0000001 -> 6 max fraction digits = "0"
    // 10_000_000 stroops = 1 XLM/second
    expect(formatRate(10_000_000n, "second")).toBe("1 XLM/second");
    expect(formatRate(1_000_000n, "second")).toBe("0.1 XLM/second");
  });

  it("formats day period using correct 86400 multiplier", () => {
    // 10_000_000 stroops/sec (= 1 XLM/sec) * 86400 = 86,400 XLM/day
    expect(formatRate(10_000_000n, "day")).toBe("86400 XLM/day");
    // e.g. 0.1 XLM/day:
    const ratePerSec = 1_000_000n / 86_400n;
    expect(formatRate(ratePerSec, "day")).toContain("XLM/day");
  });

  it("formats month period using correct 2592000 (30-day) multiplier", () => {
    // 1 stroop/sec * 2_592_000 = 2_592_000 stroops = 0.2592 XLM/month
    expect(formatRate(1n, "month")).toBe("0.2592 XLM/month");
    // 10 stroops/sec * 2_592_000 = 25_920_000 stroops = 2.592 XLM/month
    expect(formatRate(10n, "month")).toBe("2.592 XLM/month");
  });

  it("formats year period using correct 31536000 (365-day) multiplier", () => {
    // 1 stroop/sec * 31_536_000 = 31_536_000 stroops = 3.1536 XLM/year
    expect(formatRate(1n, "year")).toBe("3.1536 XLM/year");
    // 10 stroops/sec * 31_536_000 = 315_360_000 stroops = 31.536 XLM/year
    expect(formatRate(10n, "year")).toBe("31.536 XLM/year");
  });

  it("supports custom token and decimals with period", () => {
    expect(formatRate(1_000_000n, "day", "USDC", 6)).toBe("86400 USDC/day");
    expect(formatRate(0n, "month", "EURC", 7)).toBe("0 EURC/month");
  });

  it("supports 4-argument signature (amtPerSec, token, decimals, period)", () => {
    expect(formatRate(10_000_000n, "XLM", 7, "day")).toBe("86400 XLM/day");
    expect(formatRate(0n, "XLM", 7, "year")).toBe("0 XLM/year");
  });

  it("throws on invalid period", () => {
    // @ts-expect-error test invalid period input
    expect(() => formatRate(10n, "decade")).toThrow(/Invalid/);
  });
});

