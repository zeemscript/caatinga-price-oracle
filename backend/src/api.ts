import express, { type Request, type Response } from "express";
import { resolveOracleContract } from "./lib/artifacts.js";
import { getLatestPrice, getPriceHistory } from "./lib/db.js";
import { createLogger } from "./lib/logger.js";
import { healthTracker } from "./lib/retry.js";
import { signerPublicKey } from "./lib/signer.js";

const logger = createLogger("api");

function serializeRow(row: ReturnType<typeof getLatestPrice>) {
  if (!row) return null;
  return {
    asset: row.asset,
    price: row.price,
    timestamp: row.timestamp,
    contractId: row.contract_id,
    ledger: row.ledger,
    txHash: row.tx_hash,
    source: row.source,
    recordedAt: row.recorded_at,
  };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req: Request, res: Response) => {
    let resolved;
    try {
      resolved = resolveOracleContract();
    } catch (err) {
      logger.error("health check could not resolve contract artifacts", err);
      return res.status(503).json({ status: "degraded", error: "artifacts_unresolvable" });
    }

    const subsystems = healthTracker.snapshot();
    const degraded = Object.values(subsystems).some((s) => !s.healthy);

    res.status(degraded ? 200 : 200).json({
      status: degraded ? "degraded" : "ok",
      network: resolved.network,
      contractId: resolved.contractId,
      signerPublicKey,
      subsystems,
    });
  });

  app.get("/artifacts", (_req: Request, res: Response) => {
    try {
      const resolved = resolveOracleContract();
      res.json({
        ...resolved,
        note: "Resolved live from caatinga.artifacts.json on every request -- never hardcoded.",
      });
    } catch (err) {
      logger.error("failed to resolve artifacts", err);
      res.status(503).json({ error: "artifacts_unresolvable" });
    }
  });

  app.get("/prices/:asset", (req: Request, res: Response) => {
    const row = getLatestPrice(req.params.asset);
    if (!row) {
      return res.status(404).json({ error: "no_price_recorded", asset: req.params.asset });
    }
    res.json(serializeRow(row));
  });

  app.get("/prices/:asset/history", (req: Request, res: Response) => {
    const limit = Math.min(500, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50);
    const before = req.query.before ? Number.parseInt(String(req.query.before), 10) : undefined;
    const rows = getPriceHistory(req.params.asset, limit, before);
    res.json({ asset: req.params.asset, count: rows.length, items: rows.map(serializeRow) });
  });

  return app;
}
