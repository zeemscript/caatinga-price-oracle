export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exponential backoff with jitter. Retries up to `maxAttempts` times,
 * re-throwing the last error if every attempt fails or `isRetryable`
 * rejects a given error outright (e.g. an auth error should not be
 * retried the same way a network timeout should).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    isRetryable = () => true,
    onRetry,
    sleep = defaultSleep,
  } = opts;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = 0.85 + Math.random() * 0.3; // +/-15%
      const delayMs = Math.round(exponential * jitter);
      onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }
}

/** Tracks consecutive failures per named subsystem for /health reporting. */
export class HealthTracker {
  private state = new Map<string, { healthy: boolean; consecutiveFailures: number; lastError?: string; lastSuccessAt?: string; lastCheckAt?: string }>();

  recordSuccess(subsystem: string) {
    const now = new Date().toISOString();
    this.state.set(subsystem, {
      healthy: true,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      lastCheckAt: now,
    });
  }

  recordFailure(subsystem: string, err: unknown) {
    const prev = this.state.get(subsystem);
    const now = new Date().toISOString();
    this.state.set(subsystem, {
      healthy: false,
      consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
      lastError: err instanceof Error ? err.message : String(err),
      lastSuccessAt: prev?.lastSuccessAt,
      lastCheckAt: now,
    });
  }

  snapshot() {
    return Object.fromEntries(this.state.entries());
  }

  isHealthy(subsystem: string): boolean {
    return this.state.get(subsystem)?.healthy ?? true;
  }
}

export const healthTracker = new HealthTracker();
