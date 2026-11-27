import { rpc } from "@stellar/stellar-sdk";
import { env } from "./env.js";
import * as OracleBinding from "./contracts/generated/oracle/src/index.js";
import { resolveOracleContract } from "./lib/artifacts.js";
import { getIndexCursor, insertPriceHistory, setIndexCursor } from "./lib/db.js";
import { errorSummary } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";
import { healthTracker, withRetry } from "./lib/retry.js";

const logger = createLogger("indexer");

// Public RPC providers only retain recent ledger history for getEvents.
// On a cold start (no cursor yet) we back-fill a bounded window rather
// than fail -- a full historical backfill beyond the retention window
// needs an archival data source and is out of scope here.
const COLD_START_LOOKBACK_LEDGERS = 500;

/**
 * Polls for PriceUpdate events emitted by whichever contract ID is
 * currently resolved from caatinga.artifacts.json. Re-resolving every
 * tick (rather than once at startup) means a redeploy that changes the
 * contract ID is picked up automatically -- the indexer does not need
 * to be restarted, and events are recorded per-contract-id so history
 * across an upgrade stays queryable and attributable.
 */
export async function runIndexerTick(): Promise<void> {
  const resolved = resolveOracleContract();
  const server = new rpc.Server(env.rpcUrl);
  const eventClient = new OracleBinding.Client({
    contractId: resolved.contractId,
    rpcUrl: env.rpcUrl,
    networkPassphrase: env.networkPassphrase,
  });

  try {
    const latest = await withRetry(() => server.getLatestLedger(), { maxAttempts: 4 });
    const cursor = getIndexCursor(resolved.contractId);
    const startLedger = cursor > 0 ? cursor + 1 : Math.max(1, latest.sequence - COLD_START_LOOKBACK_LEDGERS);

    if (startLedger > latest.sequence) {
      healthTracker.recordSuccess("indexer");
      return;
    }

    const response = await withRetry(
      () =>
        server.getEvents({
          startLedger,
          filters: [
            {
              type: "contract",
              contractIds: [resolved.contractId],
              topics: [eventClient.priceUpdateEventFilter()],
            },
          ],
          limit: 100,
        }),
      {
        maxAttempts: 4,
        onRetry: (attempt, err, delayMs) =>
          logger.warn("retrying getEvents", { attempt, delayMs, ...errorSummary(err) }),
      }
    );

    let inserted = 0;
    for (const event of response.events) {
      const parsed = eventClient.parseEvent(event.topic, event.value);
      if (!parsed || parsed.name !== "PriceUpdate") continue;
      const { asset, price, timestamp } = parsed.data;
      if (price === undefined || timestamp === undefined) continue;

      const applied = insertPriceHistory({
        asset,
        contract_id: resolved.contractId,
        price: price.toString(),
        timestamp: Number(timestamp),
        ledger: event.ledger,
        tx_hash: event.txHash ?? null,
        source: "indexer-event",
      });
      if (applied) inserted++;
    }

    setIndexCursor(resolved.contractId, response.latestLedger ?? latest.sequence);
    healthTracker.recordSuccess("indexer");

    if (inserted > 0) {
      logger.info("indexed price_update events", { count: inserted, contractId: resolved.contractId, startLedger });
    }
  } catch (err) {
    healthTracker.recordFailure("indexer", err);
    logger.error("indexer tick failed", errorSummary(err));
  }
}

export function startIndexerLoop(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    await runIndexerTick();
    if (!stopped) {
      timer = setTimeout(tick, env.indexIntervalMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
