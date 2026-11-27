import { CaatingaError, CaatingaErrorCode } from "@caatinga/core/browser";
import { describe, expect, it } from "vitest";
import { describeContractError, isRetryable } from "../src/lib/errors.js";

describe("isRetryable", () => {
  it("retries transient infrastructure codes", () => {
    expect(isRetryable(new CaatingaError("rpc hiccup", CaatingaErrorCode.XDR_SUBMIT_FAILED))).toBe(true);
    expect(isRetryable(new CaatingaError("rpc hiccup", CaatingaErrorCode.READ_RESULT_MISSING))).toBe(true);
  });

  it("does not retry a deterministic contract-level rejection", () => {
    const err = new CaatingaError(
      "contract error",
      CaatingaErrorCode.XDR_RESULT_FAILED,
      undefined,
      { message: "Unauthorized" }
    );
    expect(isRetryable(err)).toBe(false);
  });

  it("does not retry a missing-artifact configuration error", () => {
    expect(isRetryable(new CaatingaError("missing", CaatingaErrorCode.CONTRACT_ARTIFACT_NOT_FOUND))).toBe(false);
  });

  it("assumes a plain network/DNS-style error is transient", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("describeContractError", () => {
  it("surfaces the underlying OracleError variant name", () => {
    const err = new CaatingaError(
      "contract error",
      CaatingaErrorCode.XDR_RESULT_FAILED,
      undefined,
      { message: "InvalidPrice" }
    );
    expect(describeContractError(err)).toBe("InvalidPrice");
  });

  it("returns undefined for non-contract errors", () => {
    expect(describeContractError(new Error("plain"))).toBeUndefined();
  });
});
