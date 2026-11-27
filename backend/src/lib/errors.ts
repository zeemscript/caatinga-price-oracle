import { CaatingaError, CaatingaErrorCode } from "@caatinga/core/browser";

/**
 * Codes that represent a transient/infrastructure failure (RPC hiccup,
 * timeout, submission race) worth retrying with backoff. Everything
 * else -- a contract-level rejection (XDR_RESULT_FAILED, e.g. our own
 * OracleError::Unauthorized/InvalidPrice), a missing artifact, a wallet
 * problem -- is a deterministic failure that will not succeed on retry,
 * so we fail fast, log it clearly, and move on instead of retry-looping.
 *
 * Per Caatinga's own docs: "Automation must key on the code, never on
 * message text."
 */
const RETRYABLE_CODES = new Set<string>([
  CaatingaErrorCode.XDR_SUBMIT_FAILED,
  CaatingaErrorCode.INVOKE_FAILED,
  CaatingaErrorCode.DEPLOY_FAILED,
  CaatingaErrorCode.READ_RESULT_MISSING,
  CaatingaErrorCode.UNEXPECTED_ERROR,
]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof CaatingaError) {
    return RETRYABLE_CODES.has(err.code);
  }
  // Non-Caatinga errors (fetch/network failures, DNS, timeouts) are
  // assumed transient by default.
  return true;
}

/** Pulls the underlying OracleError variant name out of a CAATINGA_XDR_RESULT_FAILED, if present. */
export function describeContractError(err: unknown): string | undefined {
  if (!(err instanceof CaatingaError)) return undefined;
  const cause = err.cause as { message?: unknown } | undefined;
  return typeof cause?.message === "string" ? cause.message : undefined;
}

export function errorSummary(err: unknown): { code?: string; message: string; contractError?: string } {
  if (err instanceof CaatingaError) {
    return { code: err.code, message: err.message, contractError: describeContractError(err) };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}
