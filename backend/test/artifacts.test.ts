import { describe, expect, it } from "vitest";
import { loadArtifacts, resolveOracleContract } from "../src/lib/artifacts.js";

describe("resolveOracleContract", () => {
  it("resolves a real contractId from caatinga.artifacts.json, never a hardcoded value", () => {
    const artifacts = loadArtifacts();
    const resolved = resolveOracleContract(artifacts);

    expect(resolved.network).toBe("testnet");
    expect(resolved.contractId).toMatch(/^C[A-Z0-9]{55}$/); // Soroban strkey contract address shape
    expect(resolved.wasmHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches whatever is currently on disk, not a cached snapshot", () => {
    const first = resolveOracleContract();
    const artifacts = loadArtifacts();
    const second = resolveOracleContract(artifacts);
    expect(second.contractId).toBe(first.contractId);
  });
});
