import { createApp } from "./api.js";
import { env } from "./env.js";
import { watchArtifacts } from "./lib/artifacts.js";
import { createLogger } from "./lib/logger.js";
import { startIndexerLoop } from "./indexer.js";
import { startRelayerLoop } from "./relayer.js";

const logger = createLogger("bootstrap");

logger.info("starting caatinga-price-oracle backend", {
  network: env.network,
  artifactsPath: env.artifactsPath,
  pollIntervalMs: env.pollIntervalMs,
  indexIntervalMs: env.indexIntervalMs,
});

const stopWatchingArtifacts = watchArtifacts((prev, next) => {
  if (!prev) {
    logger.info("resolved oracle contract from caatinga.artifacts.json", next);
    return;
  }
  if (prev.contractId !== next.contractId) {
    logger.warn("contract REDEPLOYED to a new instance -- switching automatically, no restart needed", {
      previousContractId: prev.contractId,
      newContractId: next.contractId,
    });
  } else if (prev.wasmHash !== next.wasmHash) {
    logger.warn("contract WASM upgraded in-place -- same contract ID, new logic takes effect immediately", {
      contractId: next.contractId,
      previousWasmHash: prev.wasmHash,
      newWasmHash: next.wasmHash,
    });
  }
});

const stopRelayer = startRelayerLoop();
const stopIndexer = startIndexerLoop();

const app = createApp();
const server = app.listen(env.httpPort, () => {
  logger.info(`HTTP API listening on :${env.httpPort}`);
});

function shutdown(signal: string) {
  logger.info(`received ${signal}, shutting down`);
  stopRelayer();
  stopIndexer();
  stopWatchingArtifacts();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
