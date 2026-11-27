import { defineConfig } from "@caatinga/core";

export default defineConfig({
  project: "caatinga-price-oracle",
  defaultNetwork: "testnet",

  contracts: {
    oracle: {
      path: "./contracts/oracle",
      wasm: "./contracts/oracle/target/wasm32v1-none/release/oracle.wasm",
    },
  },

  networks: {
    testnet: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
    mainnet: {
      rpcUrl: "https://mainnet.sorobanrpc.com",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    },
  },

  // No UI ships in this project; bindingsOutput is set purely so `ctg generate`
  // produces a typed client for the backend service to import.
  frontend: {
    bindingsOutput: "./backend/src/contracts/generated",
  },

  // Runs once, right after deploy, signed by the same --source identity
  // that deployed the contract. Claims the admin role so set_price/upgrade
  // are gated to this backend's signing key.
  postDeploy: [
    {
      contract: "oracle",
      method: "initialize",
      args: { admin: "${source.address}" },
      kind: "invoke",
      expect: { matcher: "reachable" },
    },
  ],

  smoke: {
    reads: [{ contract: "oracle", method: "version", expect: { matcher: "reachable" } }],
  },
});
