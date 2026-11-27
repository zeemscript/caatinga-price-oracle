import { describe, expect, it } from "vitest";
import { getLatestPrice, getPriceHistory, insertPriceHistory } from "../src/lib/db.js";

function uniqueContractId() {
  return `CTEST${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

describe("price_history idempotency", () => {
  it("accepts the first write for a given (asset, contract, timestamp)", () => {
    const contractId = uniqueContractId();
    const applied = insertPriceHistory({
      asset: "XLM",
      contract_id: contractId,
      price: "1200000",
      timestamp: 1_000,
      ledger: 42,
      tx_hash: "abc",
      source: "indexer-event",
    });
    expect(applied).toBe(true);
    expect(getLatestPrice(`XLM-${contractId}`)).toBeUndefined(); // sanity: asset key is literal, not composite
  });

  it("ignores a duplicate write for the same (asset, contract, timestamp) instead of erroring or double-counting", () => {
    const contractId = uniqueContractId();
    const row = {
      asset: "BTC",
      contract_id: contractId,
      price: "900000000000",
      timestamp: 2_000,
      ledger: 10,
      tx_hash: "tx-1",
      source: "indexer-event" as const,
    };

    expect(insertPriceHistory(row)).toBe(true);
    // Simulates a retried submission or an overlapping re-scan of the same ledger range.
    expect(insertPriceHistory({ ...row, tx_hash: "tx-1-retry", ledger: 10 })).toBe(false);

    const history = getPriceHistory("BTC", 10);
    const matching = history.filter((h) => h.contract_id === contractId);
    expect(matching).toHaveLength(1);
  });

  it("treats a newer timestamp for the same asset/contract as a distinct row", () => {
    const contractId = uniqueContractId();
    insertPriceHistory({
      asset: "XLM",
      contract_id: contractId,
      price: "1200000",
      timestamp: 3_000,
      ledger: 1,
      tx_hash: null,
      source: "relayer-submit",
    });
    insertPriceHistory({
      asset: "XLM",
      contract_id: contractId,
      price: "1250000",
      timestamp: 3_100,
      ledger: 2,
      tx_hash: null,
      source: "relayer-submit",
    });

    const latest = getLatestPrice("XLM");
    expect(latest?.contract_id).toBe(contractId);
    expect(latest?.timestamp).toBe(3_100);

    const history = getPriceHistory("XLM", 10).filter((h) => h.contract_id === contractId);
    expect(history).toHaveLength(2);
    expect(history[0].timestamp).toBeGreaterThan(history[1].timestamp); // DESC order
  });
});
