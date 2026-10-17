import { NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: NextRequest) => string;
}

interface RequestMetrics {
  count: number;
  resetTime: number;
}

const store = new Map<string, RequestMetrics>();

export const cleanupStore = () => {
  const now = Date.now();
  for (const [key, metrics] of store.entries()) {
    if (now > metrics.resetTime) {
      store.delete(key);
    }
  }
};

/** Reset in-memory rate limit store (used in tests). */
export function _resetRateLimitStore(): void {
  store.clear();
}

/** Get configurable RPM limit from RATE_LIMIT_RPM env var, default 100. */
export function getRateLimitRPM(): number {
  const envVal = process.env.RATE_LIMIT_RPM;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 100;
}

/** Determine if a path is exempt from rate limiting (/health and /metrics). */
export function isRateLimitExempt(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  const exempt = [
    "/health",
    "/metrics",
    "/api/health",
    "/api/ready",
    "/api/metrics",
    "/api/contracts/metrics",
    "/api/v1/contracts/metrics",
  ];
  return exempt.some((p) => normalized === p || normalized.startsWith(p + "/"));
}

export function extractClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = forwardedFor.split(",")[0].trim();
    if (ip) return ip;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return "unknown";
}

/**
 * Check global IP-based rate limit for a request.
 * Returns 429 response if breached, or null if allowed.
 */
export function checkGlobalRateLimit(
  request: NextRequest,
  options?: { maxRequests?: number; windowMs?: number }
): NextResponse | null {
  cleanupStore();

  const windowMs = options?.windowMs ?? 60_000;
  const maxRequests = options?.maxRequests ?? getRateLimitRPM();
  const clientIp = extractClientIp(request);
  const key = `ip:${clientIp}`;
  const now = Date.now();

  let metrics = store.get(key);
  if (!metrics || now > metrics.resetTime) {
    metrics = {
      count: 0,
      resetTime: now + windowMs,
    };
    store.set(key, metrics);
  }

  metrics.count++;

  if (metrics.count > maxRequests) {
    const resetTime = metrics.resetTime;
    const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));
    return new NextResponse(
      JSON.stringify({
        error: "Too many requests",
        message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.floor(windowMs / 1000)} seconds allowed.`,
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
          "Content-Type": "application/json",
        },
      }
    );
  }

  return null;
}

export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req: NextRequest) => extractClientIp(req),
  } = config;

  return async (request: NextRequest): Promise<NextResponse | null> => {
    cleanupStore();

    const key = keyGenerator(request);
    const now = Date.now();
    let metrics = store.get(key);

    if (!metrics || now > metrics.resetTime) {
      metrics = {
        count: 0,
        resetTime: now + windowMs,
      };
      store.set(key, metrics);
    }

    metrics.count++;

    if (metrics.count > maxRequests) {
      const resetTime = metrics.resetTime;
      const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));
      return new NextResponse(
        JSON.stringify({
          error: "Too many requests",
          message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.floor(windowMs / 1000)} seconds allowed.`,
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Retry-After": retryAfter.toString(),
            "Content-Type": "application/json",
          },
        }
      );
    }

    return null;
  };
}

export function createIpBasedRateLimiter(windowMs: number, maxRequests: number) {
  return createRateLimiter({
    windowMs,
    maxRequests,
  });
}

export function createEndpointSpecificRateLimiter(
  windowMs: number,
  maxRequests: number,
  endpoint: string
) {
  return createRateLimiter({
    windowMs,
    maxRequests,
    keyGenerator: (req: NextRequest) => {
      const clientIp = extractClientIp(req);
      return `${endpoint}:${clientIp}`;
    },
  });
}

