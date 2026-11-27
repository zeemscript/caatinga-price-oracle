import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/lib/retry.js";

const noSleep = async () => {};

describe("withRetry", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { sleep: noSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom 1"))
      .mockRejectedValueOnce(new Error("boom 2"))
      .mockResolvedValueOnce("recovered");

    const onRetry = vi.fn();
    const result = await withRetry(fn, { sleep: noSleep, onRetry, maxAttempts: 5 });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("gives up and throws after maxAttempts", async () => {
    const err = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: noSleep, maxAttempts: 3 })).rejects.toThrow("persistent failure");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when isRetryable rejects the error", async () => {
    const err = new Error("deterministic failure");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, { sleep: noSleep, maxAttempts: 5, isRetryable: () => false })
    ).rejects.toThrow("deterministic failure");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off with increasing delay", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const delays: number[] = [];
    await withRetry(fn, {
      sleep: noSleep,
      baseDelayMs: 100,
      onRetry: (_attempt, _err, delayMs) => delays.push(delayMs),
    });

    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0] * 1.5); // exponential, allowing for jitter
  });
});
