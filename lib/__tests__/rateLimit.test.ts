import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  checkGlobalRateLimit,
  isRateLimitExempt,
  getRateLimitRPM,
  _resetRateLimitStore,
} from "../rateLimit";
import { middleware } from "../../middleware";

describe("Issue #1060: Per-IP rate limiting with configurable thresholds", () => {
  beforeEach(() => {
    _resetRateLimitStore();
    delete process.env.RATE_LIMIT_RPM;
  });

  it("allows requests below the threshold", () => {
    process.env.RATE_LIMIT_RPM = "5";
    const ip = "192.168.1.10";

    for (let i = 0; i < 5; i++) {
      const req = new NextRequest("http://localhost:3000/api/some-endpoint", {
        headers: { "x-forwarded-for": ip },
      });
      const res = checkGlobalRateLimit(req);
      expect(res).toBeNull();
    }
  });

  it("returns 429 with Retry-After header after RATE_LIMIT_RPM breached", () => {
    process.env.RATE_LIMIT_RPM = "3";
    const ip = "192.168.1.20";

    for (let i = 0; i < 3; i++) {
      const req = new NextRequest("http://localhost:3000/api/some-endpoint", {
        headers: { "x-forwarded-for": ip },
      });
      expect(checkGlobalRateLimit(req)).toBeNull();
    }

    // 4th request breaches the limit
    const overLimitReq = new NextRequest("http://localhost:3000/api/some-endpoint", {
      headers: { "x-forwarded-for": ip },
    });
    const res = checkGlobalRateLimit(overLimitReq);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);

    const retryAfter = res?.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
  });

  it("uses default 100 requests/min when RATE_LIMIT_RPM is not set", () => {
    expect(getRateLimitRPM()).toBe(100);
  });

  it("correctly identifies exempt paths for /health and /metrics", () => {
    expect(isRateLimitExempt("/health")).toBe(true);
    expect(isRateLimitExempt("/health/")).toBe(true);
    expect(isRateLimitExempt("/metrics")).toBe(true);
    expect(isRateLimitExempt("/api/health")).toBe(true);
    expect(isRateLimitExempt("/api/ready")).toBe(true);
    expect(isRateLimitExempt("/api/contracts/metrics")).toBe(true);
    expect(isRateLimitExempt("/api/v1/contracts/metrics")).toBe(true);

    // Non-exempt paths
    expect(isRateLimitExempt("/api/search")).toBe(false);
    expect(isRateLimitExempt("/api/gives/batch")).toBe(false);
    expect(isRateLimitExempt("/api/profile/G123/gives-summary")).toBe(false);
  });

  it("middleware enforces rate limiting and respects exemptions", () => {
    process.env.RATE_LIMIT_RPM = "2";
    const ip = "10.0.0.99";

    // First two requests succeed
    for (let i = 0; i < 2; i++) {
      const req = new NextRequest("http://localhost:3000/api/some-endpoint", {
        headers: { "x-forwarded-for": ip },
      });
      const res = middleware(req);
      expect(res.status).not.toBe(429);
    }

    // 3rd request to regular API route is rate-limited (429)
    const rateLimitedReq = new NextRequest("http://localhost:3000/api/some-endpoint", {
      headers: { "x-forwarded-for": ip },
    });
    const res429 = middleware(rateLimitedReq);
    expect(res429.status).toBe(429);
    expect(res429.headers.get("Retry-After")).toBeDefined();

    // Requests to /health and /metrics are exempt even from the rate-limited IP
    const healthReq = new NextRequest("http://localhost:3000/api/health", {
      headers: { "x-forwarded-for": ip },
    });
    const healthRes = middleware(healthReq);
    expect(healthRes.status).not.toBe(429);

    const metricsReq = new NextRequest("http://localhost:3000/api/contracts/metrics", {
      headers: { "x-forwarded-for": ip },
    });
    const metricsRes = middleware(metricsReq);
    expect(metricsRes.status).not.toBe(429);
  });
});
