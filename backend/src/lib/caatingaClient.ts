import { createCaatingaClient } from "@caatinga/client";
import * as OracleBinding from "../contracts/generated/oracle/src/index.js";
import { env } from "../env.js";
import { loadArtifacts, resolveOracleContract } from "./artifacts.js";
import { signer } from "./signer.js";

/**
 * Builds a fresh CaatingaContractClient for every call. The underlying
 * `createCaatingaClient` is a cheap, stateless factory (see Caatinga's
 * own source: it just closes over config), so there is no benefit to
 * caching it across calls and a real risk of caching a stale
 * `contractId` if we did -- rebuilding it from a freshly re-read
 * artifacts file is what makes "resolve from Caatinga artifacts
 * instead of hardcoding" actually true at every single call site,
 * including immediately after an upgrade/redeploy.
 */
export function getOracleContract() {
  const artifacts = loadArtifacts();
  const resolved = resolveOracleContract(artifacts);

  const client = createCaatingaClient({
    network: {
      name: env.network,
      rpcUrl: env.rpcUrl,
      networkPassphrase: env.networkPassphrase,
    },
    artifacts,
    wallet: signer,
    contracts: {
      oracle: { binding: OracleBinding },
    },
  });

  return { contract: client.contract("oracle"), resolved };
}
