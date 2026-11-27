import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function parseAssetMap(raw: string): Array<{ feedId: string; asset: string }> {
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [feedId, asset] = pair.split(":");
      if (!feedId || !asset) {
        throw new Error(`Invalid PRICE_FEED_ASSETS entry "${pair}", expected "<feedId>:<asset>"`);
      }
      return { feedId, asset };
    });
}

export const env = {
  network: optional("CAATINGA_NETWORK", "testnet"),
  artifactsPath: resolve(process.cwd(), optional("CAATINGA_ARTIFACTS_PATH", "../caatinga.artifacts.json")),
  rpcUrl: optional("RPC_URL", "https://soroban-testnet.stellar.org"),
  networkPassphrase: optional("NETWORK_PASSPHRASE", "Test SDF Network ; September 2015"),
  signerSecret: required("ORACLE_SIGNER_SECRET"),
  priceFeedAssets: parseAssetMap(optional("PRICE_FEED_ASSETS", "stellar:XLM")),
  pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 30_000),
  indexIntervalMs: optionalInt("INDEX_INTERVAL_MS", 15_000),
  artifactsPollIntervalMs: optionalInt("ARTIFACTS_POLL_INTERVAL_MS", 5_000),
  httpPort: optionalInt("HTTP_PORT", 8080),
  sqlitePath: resolve(process.cwd(), optional("SQLITE_PATH", "./data/oracle.db")),
  coingeckoBaseUrl: optional("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3"),
};
