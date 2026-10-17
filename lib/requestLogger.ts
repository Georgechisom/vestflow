import { NextRequest, NextResponse } from "next/server";

const REQUEST_START_HEADER = "x-request-start";
const REQUEST_ID_HEADER = "x-request-id";
const ACCOUNT_PARAM = "account";

/** Header set on every API response so clients can observe server-side latency. */
export const RESPONSE_TIME_HEADER = "X-Response-Time";

export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  /** Stellar account address when present in the request's `account` query param (#1072). */
  account?: string;
}

export function logRequest(entry: RequestLogEntry): void {
  console.log(JSON.stringify(entry));
}

export function withLogging<TArgs extends any[]>(
  handler: (...args: TArgs) => Promise<NextResponse>
) {
  return async (...args: TArgs): Promise<NextResponse> => {
    const request = args[0] as NextRequest;
    const { pathname, searchParams } = request.nextUrl;
    const method = request.method;
    const requestId = request.headers.get(REQUEST_ID_HEADER) || "unknown";
    const startHeader = request.headers.get(REQUEST_START_HEADER);
    const startMs = startHeader ? Number(startHeader) : Date.now();

    // #1072 — extract account from query params; never log sensitive auth values.
    const account = searchParams.get(ACCOUNT_PARAM) ?? undefined;

    let response: NextResponse | null = null;
    let status = 500;
    try {
      response = await handler(...args);
      status = response.status;
      return response;
    } catch (error) {
      status = 500;
      throw error;
    } finally {
      const durationMs = Date.now() - startMs;

      // #1075 — set X-Response-Time on the response so clients can observe latency.
      // The mutation happens in `finally` so it applies even when an error is thrown,
      // and the caller sees the updated headers because objects are passed by reference.
      if (response) {
        response.headers.set(RESPONSE_TIME_HEADER, `${durationMs}ms`);
      }

      logRequest({
        timestamp: new Date().toISOString(),
        method,
        path: pathname,
        status,
        durationMs,
        requestId,
        ...(account ? { account } : {}),
      });
    }
  };
}
