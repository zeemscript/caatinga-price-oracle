import { CaatingaError, CaatingaErrorCode } from "@caatinga/core/browser";
import { env } from "./env.js";
import { getOracleContract } from "./lib/caatingaClient.js";
import { insertPriceHistory } from "./lib/db.js";
import { describeContractError, errorSummary, isRetryable } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";
import { fetchPrices, type PriceReading } from "./lib/priceFeed.js";
import { healthTracker, withRetry } from "./lib/retry.js";
import { signerPublicKey } from "./lib/signer.js";

const logger = createLogger("relayer");

/** Reads the current on-chain price so we skip a submission that would be a no-op anyway (saves fees, avoids needless chain traffic on every poll). */
async function getOnChainTimestamp(asset: string): Promise<bigint | undefined> {
  const { contract } = getOracleContract();
  try {
    const data = await contract.read<{ price: bigint; timestamp: bigint }>("get_price", { asset });
    return data.timestamp;
  } catch (err) {
    // get_price's only contract-level failure mode is OracleError::AssetNotFound
    // (variant #4) -- any CAATINGA_XDR_RESULT_FAILED here means "no price
    // recorded yet," not an actual problem. Matched on the error *code*
    // rather than the decoded message text, since the message is only as
    // good as the Rust enum's doc comments (see docs/friction-log.md).
    if (err instanceof CaatingaError && err.code === CaatingaErrorCode.XDR_RESULT_FAILED) {
      return undefined; // first-ever write for this asset
    }
    throw err;
  }
}

async function submitReading(reading: PriceReading): Promise<void> {
  const onChainTimestamp = await withRetry(() => getOnChainTimestamp(reading.asset), {
    maxAttempts: 4,
    isRetryable,
    onRetry: (attempt, err, delayMs) =>
      logger.warn("retrying on-chain read before submit", { asset: reading.asset, attempt, delayMs, ...errorSummary(err) }),
  });

  if (onChainTimestamp !== undefined && onChainTimestamp >= BigInt(reading.timestamp)) {
    logger.debug("skip: on-chain price already current", { asset: reading.asset, onChainTimestamp: onChainTimestamp.toString() });
    return;
  }

  const { contract, resolved } = getOracleContract();

  try {
    const result = await withRetry(
      () =>
        contract.invoke<boolean>("set_price", {
          caller: signerPublicKey,
          asset: reading.asset,
          price: reading.scaledPrice,
          timestamp: BigInt(reading.timestamp),
        }),
      {
        maxAttempts: 4,
        isRetryable,
        onRetry: (attempt, err, delayMs) =>
          logger.warn("retrying set_price submission", { asset: reading.asset, attempt, delayMs, ...errorSummary(err) }),
      }
    );

    healthTracker.recordSuccess("chainSubmit");

    if (result.result === false) {
      // Applied === false: a concurrent/duplicate submission already advanced
      // the timestamp between our read and our invoke. Safe no-op either way
      // -- this is exactly the idempotency guarantee set_price provides.
      logger.info("set_price was a no-op (already applied by a concurrent submission)", { asset: reading.asset });
      return;
    }

    insertPriceHistory({
      asset: reading.asset,
      contract_id: resolved.contractId,
      price: reading.scaledPrice.toString(),
      timestamp: reading.timestamp,
      ledger: null,
      tx_hash: result.transactionHash ?? null,
      source: "relayer-submit",
    });

    logger.info("submitted price update on-chain", {
      asset: reading.asset,
      usdPrice: reading.usdPrice,
      contractId: resolved.contractId,
      txHash: result.transactionHash,
    });
  } catch (err) {
    healthTracker.recordFailure("chainSubmit", err);
    const summary = errorSummary(err);
    if (summary.contractError) {
      // Deterministic contract-level rejection (e.g. Unauthorized, InvalidPrice
      // after a bounds-checking upgrade) -- logged loudly but not retried,
      // and does not crash the relayer loop.
      logger.error("contract rejected set_price", { asset: reading.asset, ...summary });
    } else {
      logger.error("set_price failed after retries", { asset: reading.asset, ...summary });
    }
  }
}

export async function runRelayerTick(): Promise<void> {
  let readings: PriceReading[];
  try {
    readings = await withRetry(
      () => fetchPrices(env.priceFeedAssets, { baseUrl: env.coingeckoBaseUrl }),
      {
        maxAttempts: 4,
        onRetry: (attempt, err, delayMs) =>
          logger.warn("retrying price feed fetch", { attempt, delayMs, ...errorSummary(err) }),
      }
    );
    healthTracker.recordSuccess("priceFeed");
  } catch (err) {
    healthTracker.recordFailure("priceFeed", err);
    logger.error("price feed unavailable after retries; skipping this tick", errorSummary(err));
    return;
  }

  for (const reading of readings) {
    try {
      await submitReading(reading);
    } catch (err) {
      // Isolate failures per-asset: one asset's unexpected error must not
      // stop the rest of this tick's assets from being processed.
      logger.error("unexpected failure processing reading (other assets still processed)", {
        asset: reading.asset,
        ...errorSummary(err),
      });
    }
  }
}

export function startRelayerLoop(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await runRelayerTick();
    } catch (err) {
      logger.error("unexpected relayer tick failure (loop continues)", errorSummary(err));
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, env.pollIntervalMs);
      }
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
