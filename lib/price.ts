import { MINT_ADDRESS } from './config';

/**
 * Current token price in USD from DexScreener (deepest-liquidity pair),
 * cached for 60s per instance. Falls back to the last known price when
 * the API hiccups; returns null only if no price was ever fetched.
 */
let cache: { ts: number; price: number } | null = null;
const TTL_MS = 60_000;

export async function getTokenPriceUsd(): Promise<number | null> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.price;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${MINT_ADDRESS}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return cache?.price ?? null;
    const data = (await res.json()) as {
      pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[];
    };
    const pairs = (data.pairs ?? []).filter((p) => p.priceUsd);
    if (pairs.length === 0) return cache?.price ?? null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const price = parseFloat(pairs[0].priceUsd!);
    if (!(price > 0)) return cache?.price ?? null;
    cache = { ts: Date.now(), price };
    return price;
  } catch {
    return cache?.price ?? null;
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
let solCache: { ts: number; price: number } | null = null;

/** Current SOL price in USD (DexScreener), cached 60s, with fallback. */
export async function getSolPriceUsd(): Promise<number | null> {
  if (solCache && Date.now() - solCache.ts < TTL_MS) return solCache.price;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return solCache?.price ?? null;
    const data = (await res.json()) as {
      pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[];
    };
    const pairs = (data.pairs ?? []).filter((p) => p.priceUsd);
    if (pairs.length === 0) return solCache?.price ?? null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const price = parseFloat(pairs[0].priceUsd!);
    if (!(price > 0)) return solCache?.price ?? null;
    solCache = { ts: Date.now(), price };
    return price;
  } catch {
    return solCache?.price ?? null;
  }
}
