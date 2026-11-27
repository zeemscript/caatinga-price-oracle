import { readFileSync, watch } from "node:fs";
import { resolveContractId } from "@caatinga/client";
import type { CaatingaArtifacts } from "@caatinga/core/browser";
import { env } from "../env.js";
import { createLogger } from "./logger.js";

const logger = createLogger("artifacts");
const CONTRACT_NAME = "oracle";

export interface ResolvedContract {
  contractId: string;
  wasmHash: string;
  deployedAt: string;
  network: string;
}

/**
 * Reads caatinga.artifacts.json fresh off disk. This file is the
 * Caatinga-versioned source of truth for deployed contract IDs; the
 * backend never hardcodes a contract ID anywhere. Re-reading on every
 * call (rather than caching) means a redeploy or upgrade is picked up
 * immediately, with no restart and no cache-invalidation logic to get
 * wrong.
 */
export function loadArtifacts(): CaatingaArtifacts {
  const raw = readFileSync(env.artifactsPath, "utf-8");
  return JSON.parse(raw) as CaatingaArtifacts;
}

/** Resolves the oracle contract's current on-chain identity from artifacts. */
export function resolveOracleContract(artifacts: CaatingaArtifacts = loadArtifacts()): ResolvedContract {
  const contractId = resolveContractId({
    artifacts,
    network: env.network,
    contract: CONTRACT_NAME,
  });
  const record = artifacts.networks[env.network]?.contracts[CONTRACT_NAME];
  return {
    contractId,
    wasmHash: record?.wasmHash ?? "unknown",
    deployedAt: record?.deployedAt ?? "unknown",
    network: env.network,
  };
}

/**
 * Background watcher purely for observability (logging + /health /
 * /artifacts freshness) -- NOT required for correctness. Every actual
 * contract call resolves fresh from disk on its own; this just makes a
 * redeploy/upgrade visible in logs the moment it happens, via both an
 * fs.watch listener (fast path) and a fallback poll (fs.watch is not
 * reliably delivered on every filesystem/container setup, so the poll
 * guarantees detection within `artifactsPollIntervalMs` regardless).
 */
export function watchArtifacts(onChange: (prev: ResolvedContract | undefined, next: ResolvedContract) => void) {
  let last: ResolvedContract | undefined;

  const check = () => {
    try {
      const resolved = resolveOracleContract();
      const changed = !last || last.contractId !== resolved.contractId || last.wasmHash !== resolved.wasmHash;
      if (changed) {
        onChange(last, resolved);
        last = resolved;
      }
    } catch (err) {
      logger.error("failed to resolve oracle contract from artifacts", err);
    }
  };

  check();
  const interval = setInterval(check, env.artifactsPollIntervalMs);

  let fsWatcher: ReturnType<typeof watch> | undefined;
  try {
    fsWatcher = watch(env.artifactsPath, { persistent: false }, () => check());
  } catch (err) {
    logger.warn("fs.watch unavailable for artifacts file, relying on poll only", err);
  }

  return () => {
    clearInterval(interval);
    fsWatcher?.close();
  };
}
