export interface PriceReading {
  asset: string;
  /** Scaled by 10^7, Stellar's conventional fixed-point precision, as an on-chain i128. */
  scaledPrice: bigint;
  usdPrice: number;
  timestamp: number;
}

export const PRICE_SCALE = 10_000_000n; // 10^7

export function scalePrice(usdPrice: number): bigint {
  return BigInt(Math.round(usdPrice * Number(PRICE_SCALE)));
}

export interface FetchPricesOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

/**
 * Fetches USD prices for the configured CoinGecko feed ids and maps them
 * onto on-chain asset symbols, scaled to integer i128 values. Throws on
 * any network/HTTP failure or malformed response -- callers are expected
 * to wrap this in retry/backoff (see lib/retry.ts) rather than swallow
 * errors here, so a feed outage is visible rather than silently skipped.
 */
export async function fetchPrices(
  assets: Array<{ feedId: string; asset: string }>,
  options: FetchPricesOptions
): Promise<PriceReading[]> {
  const fetchFn = options.fetchImpl ?? fetch;
  const now = options.nowMs?.() ?? Date.now();
  const ids = assets.map((a) => a.feedId).join(",");
  const url = `${options.baseUrl}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;

  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`price feed request failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as Record<string, { usd?: number }>;

  return assets.map(({ feedId, asset }) => {
    const usdPrice = body[feedId]?.usd;
    if (typeof usdPrice !== "number" || !Number.isFinite(usdPrice) || usdPrice <= 0) {
      throw new Error(`price feed returned no usable USD price for "${feedId}" (asset ${asset})`);
    }
    return {
      asset,
      usdPrice,
      scaledPrice: scalePrice(usdPrice),
      timestamp: Math.floor(now / 1000),
    };
  });
}
