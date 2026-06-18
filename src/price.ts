/**
 * QIE price oracle — backed by the QIE explorer's real market stats.
 *
 * Source: GET https://testnet.qie.digital/api/v2/stats
 *   - coin_price: real mainnet QIE USD price (sourced via CoinGecko)
 *   - market_cap, gas_prices, average_block_time
 *   Historical: GET /api/v2/stats/charts/market (daily closing_price)
 *
 * Note: testnet QIE has no real value, but the explorer surfaces the
 * mainnet price. For invoices this gives an honest USD-equivalent display.
 */
import type { Env } from "./types";

const EXPLORER_STATS = "https://testnet.qie.digital/api/v2/stats";

export interface QiePrice {
  usd: number | null;
  marketCapUsd: number | null;
  changePct: number | null;
  fetchedAt: number;
  source: string;
}

let cache: { t: number; data: QiePrice } | null = null;
const CACHE_MS = 60_000; // 1 min

export async function getQiePrice(_env?: Env): Promise<QiePrice> {
  if (cache && Date.now() - cache.t < CACHE_MS) return cache.data;
  try {
    const r = await fetch(EXPLORER_STATS, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`stats ${r.status}`);
    const d: any = await r.json();
    const price: QiePrice = {
      usd: d.coin_price ? parseFloat(d.coin_price) : null,
      marketCapUsd: d.market_cap ? parseFloat(d.market_cap) : null,
      changePct: d.coin_price_change_percentage != null ? parseFloat(d.coin_price_change_percentage) : null,
      fetchedAt: Date.now(),
      source: "qie.explorer/v2/stats",
    };
    cache = { t: Date.now(), data: price };
    return price;
  } catch (e) {
    // Fail open: return null price so callers can still render QIE-only.
    return { usd: null, marketCapUsd: null, changePct: null, fetchedAt: Date.now(), source: "unavailable" };
  }
}

/** Format a USD-equivalent string for a QIE amount, or null if no price. */
export function usdEquiv(qieAmount: number, price: QiePrice): string | null {
  if (price.usd == null) return null;
  const usd = qieAmount * price.usd;
  if (usd < 0.01) return `<$0.01`;
  return `≈$${usd.toFixed(2)} USD`;
}
