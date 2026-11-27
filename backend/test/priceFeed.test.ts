import { describe, expect, it } from "vitest";
import { fetchPrices, scalePrice, PRICE_SCALE } from "../src/lib/priceFeed.js";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
}

describe("scalePrice", () => {
  it("scales USD prices to 7-decimal fixed point", () => {
    expect(scalePrice(0.1234567)).toBe(1_234_567n);
    expect(scalePrice(1)).toBe(PRICE_SCALE);
  });
});

describe("fetchPrices", () => {
  const assets = [
    { feedId: "stellar", asset: "XLM" },
    { feedId: "bitcoin", asset: "BTC" },
  ];

  it("maps feed ids to on-chain asset symbols with scaled prices", async () => {
    const fetchImpl = fakeFetch({ stellar: { usd: 0.12 }, bitcoin: { usd: 90000 } });
    const readings = await fetchPrices(assets, { baseUrl: "https://example.test", fetchImpl, nowMs: () => 1_700_000_000_000 });

    expect(readings).toEqual([
      { asset: "XLM", usdPrice: 0.12, scaledPrice: 1_200_000n, timestamp: 1_700_000_000 },
      { asset: "BTC", usdPrice: 90000, scaledPrice: 900_000_000_000n, timestamp: 1_700_000_000 },
    ]);
  });

  it("throws on a non-2xx HTTP response (so callers can retry/backoff)", async () => {
    const fetchImpl = fakeFetch({}, 503);
    await expect(fetchPrices(assets, { baseUrl: "https://example.test", fetchImpl })).rejects.toThrow(/503/);
  });

  it("throws when a requested asset is missing from the response", async () => {
    const fetchImpl = fakeFetch({ stellar: { usd: 0.12 } }); // bitcoin missing
    await expect(fetchPrices(assets, { baseUrl: "https://example.test", fetchImpl })).rejects.toThrow(/bitcoin/);
  });

  it("throws on a non-positive or non-numeric price instead of pushing garbage on-chain", async () => {
    const fetchImpl = fakeFetch({ stellar: { usd: 0 }, bitcoin: { usd: 90000 } });
    await expect(fetchPrices(assets, { baseUrl: "https://example.test", fetchImpl })).rejects.toThrow(/stellar/);
  });
});
