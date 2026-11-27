import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env.js";

mkdirSync(dirname(env.sqlitePath), { recursive: true });

export const db = new Database(env.sqlitePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    price TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    ledger INTEGER,
    tx_hash TEXT,
    source TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(asset, contract_id, timestamp)
  );

  CREATE INDEX IF NOT EXISTS idx_price_history_asset ON price_history(asset, timestamp DESC);

  CREATE TABLE IF NOT EXISTS index_cursor (
    contract_id TEXT PRIMARY KEY,
    last_ledger INTEGER NOT NULL
  );
`);

export interface PriceHistoryRow {
  id: number;
  asset: string;
  contract_id: string;
  price: string;
  timestamp: number;
  ledger: number | null;
  tx_hash: string | null;
  source: "relayer-submit" | "indexer-event";
  recorded_at: string;
}

/** Idempotent insert: re-processing the same (asset, contract, timestamp) is a no-op, not a duplicate row. */
export function insertPriceHistory(row: Omit<PriceHistoryRow, "id" | "recorded_at">): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO price_history (asset, contract_id, price, timestamp, ledger, tx_hash, source, recorded_at)
       VALUES (@asset, @contract_id, @price, @timestamp, @ledger, @tx_hash, @source, @recorded_at)`
    )
    .run({ ...row, recorded_at: new Date().toISOString() });
  return result.changes > 0;
}

export function getLatestPrice(asset: string): PriceHistoryRow | undefined {
  return db
    .prepare(`SELECT * FROM price_history WHERE asset = ? ORDER BY timestamp DESC LIMIT 1`)
    .get(asset) as PriceHistoryRow | undefined;
}

export function getPriceHistory(asset: string, limit: number, before?: number): PriceHistoryRow[] {
  if (before !== undefined) {
    return db
      .prepare(
        `SELECT * FROM price_history WHERE asset = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`
      )
      .all(asset, before, limit) as PriceHistoryRow[];
  }
  return db
    .prepare(`SELECT * FROM price_history WHERE asset = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(asset, limit) as PriceHistoryRow[];
}

export function getIndexCursor(contractId: string): number {
  const row = db.prepare(`SELECT last_ledger FROM index_cursor WHERE contract_id = ?`).get(contractId) as
    | { last_ledger: number }
    | undefined;
  return row?.last_ledger ?? 0;
}

export function setIndexCursor(contractId: string, ledger: number): void {
  db.prepare(
    `INSERT INTO index_cursor (contract_id, last_ledger) VALUES (?, ?)
     ON CONFLICT(contract_id) DO UPDATE SET last_ledger = excluded.last_ledger`
  ).run(contractId, ledger);
}
