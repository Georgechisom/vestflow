/**
 * Per-ledger retry with exponential backoff (#1069).
 *
 * When processing the events of a single ledger fails, the poller retries that
 * ledger up to {@link LEDGER_MAX_RETRIES} times with the backoff schedule
 * `1s, 2s, 4s, 8s, 16s` before giving up. A ledger that exhausts every retry is
 * logged and skipped so it can never stall the poller or block the checkpoint
 * from advancing.
 *
 * Processing itself is idempotent (event inserts are `INSERT OR IGNORE` keyed by
 * Stellar event id), so a retry that partially applied a ledger is safe to
 * repeat from the beginning.
 */

import { sleep } from "./retry";

/** Number of retries attempted after the first failure (5 → up to 6 tries). */
export const LEDGER_MAX_RETRIES = 5;

/** Base delay for the first retry, in milliseconds. */
export const LEDGER_BASE_DELAY_MS = 1000;

/** Hard ceiling on any single retry delay, in milliseconds. */
export const LEDGER_MAX_DELAY_MS = 16_000;

export interface LedgerRetryOptions {
  /** Retries after the first failure. Default 5. */
  maxRetries?: number;
  /** Delay before the first retry. Default 1000 ms. */
  baseDelayMs?: number;
  /** Ceiling for any single delay. Default 16000 ms. */
  maxDelayMs?: number;
  /** Label prepended to log lines, e.g. `"[poller]"`. */
  label?: string;
  /** Injectable sleep so tests don't wait on real timers. */
  doSleep?: (ms: number) => Promise<void>;
  /** Called before each backoff sleep. */
  onRetry?: (error: unknown, retry: number, delayMs: number) => void;
  /** Called once when every retry has been exhausted. */
  onPermanentFailure?: (error: unknown, attempts: number) => void;
}

export interface LedgerRetryResult<T> {
  /** True when the ledger was processed on some attempt. */
  success: boolean;
  /** Value returned by the successful attempt, if any. */
  value?: T;
  /** Total number of attempts made (1 + retries used). */
  attempts: number;
  /** Last error seen, present only when `success` is false. */
  error?: unknown;
  /** True when the ledger exhausted its retries and was skipped. */
  skipped?: boolean;
}

/** Delay (ms) for the retry with the given zero-based index. */
export function ledgerBackoffDelayMs(
  retry: number,
  base = LEDGER_BASE_DELAY_MS,
  ceiling = LEDGER_MAX_DELAY_MS,
): number {
  return Math.min(base * Math.pow(2, retry), ceiling);
}

/** The full backoff schedule for the default (or a custom) retry budget. */
export function ledgerRetryDelays(
  maxRetries = LEDGER_MAX_RETRIES,
  base = LEDGER_BASE_DELAY_MS,
  ceiling = LEDGER_MAX_DELAY_MS,
): number[] {
  return Array.from({ length: maxRetries }, (_value, retry) =>
    ledgerBackoffDelayMs(retry, base, ceiling),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run `process` for `ledger`, retrying on failure with exponential backoff.
 *
 * Never throws for a ledger that keeps failing: after `maxRetries` retries the
 * failure is logged, `onPermanentFailure` fires, and a `{ success: false }`
 * result is returned so the caller can skip the ledger and keep going.
 */
export async function processLedgerWithRetry<T>(
  ledger: number,
  process: () => T | Promise<T>,
  options: LedgerRetryOptions = {},
): Promise<LedgerRetryResult<T>> {
  const {
    maxRetries = LEDGER_MAX_RETRIES,
    baseDelayMs = LEDGER_BASE_DELAY_MS,
    maxDelayMs = LEDGER_MAX_DELAY_MS,
    label = "[ledger-retry]",
    doSleep = sleep,
    onRetry,
    onPermanentFailure,
  } = options;

  const totalAttempts = maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const value = await process();
      return { success: true, value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;

      // The final attempt is not retried — fall through to permanent failure.
      if (attempt === maxRetries) break;

      const delay = ledgerBackoffDelayMs(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `${label} ledger ${ledger} attempt ${attempt + 1}/${totalAttempts} failed: ` +
          `${errorMessage(error)}. Retrying in ${delay}ms…`,
      );
      onRetry?.(error, attempt, delay);
      await doSleep(delay);
    }
  }

  console.error(
    `${label} PERMANENT: ledger ${ledger} failed after ${totalAttempts} attempts ` +
      `and was skipped. Last error: ${errorMessage(lastError)}`,
  );
  onPermanentFailure?.(lastError, totalAttempts);

  return { success: false, attempts: totalAttempts, error: lastError, skipped: true };
}
