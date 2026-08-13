import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';
import { MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * Price performance of each skin: token price when the skin left (or now,
 * for the current one) vs when it entered, as a signed percentage.
 * Candles come from GeckoTerminal (public, keyless), merged across the
 * token's pools so pre-migration eras are covered too.
 */

interface SkinsPayload {
  perfs: Record<string, number | null>;
}

let cache: { ts: number; data: SkinsPayload } | null = null;
// Last successful computation — served whenever a refresh fails (e.g.
// GeckoTerminal rate limit), so a bad fetch never blanks the badges
let lastGood: SkinsPayload | null = null;
const CACHE_MS = 180_000;

type Candle = [ts: number, close: number];

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getPoolAddresses(): Promise<string[]> {
  const data = (await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT_ADDRESS}/pools`,
  )) as { data?: { attributes?: { address?: string } }[] } | null;
  return (data?.data ?? [])
    .map((p) => p.attributes?.address)
    .filter((a): a is string => typeof a === 'string')
    .slice(0, 3);
}

async function getCandles(pool: string): Promise<Candle[]> {
  const data = (await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=1000`,
  )) as { data?: { attributes?: { ohlcv_list?: number[][] } } } | null;
  const list = data?.data?.attributes?.ohlcv_list ?? [];
  return list.map((c) => [c[0], c[4]] as Candle);
}

/** Close price of the latest candle at or before `ts` (1h tolerance after). */
function priceAt(candles: Candle[], ts: number): number | null {
  let best: Candle | null = null;
  for (const c of candles) {
    if (c[0] <= ts && (!best || c[0] > best[0])) best = c;
  }
  if (best) return best[1];
  // No candle before ts (era predates data): accept one shortly after
  let after: Candle | null = null;
  for (const c of candles) {
    if (c[0] > ts && c[0] - ts <= 3600 && (!after || c[0] < after[0])) after = c;
  }
  return after ? after[1] : null;
}

export async function GET() {
  if (!MINT_ADDRESS) {
    return NextResponse.json({ error: 'Token not configured.' }, { status: 500 });
  }
  if (cache && Date.now() - cache.ts < CACHE_MS) {
    return NextResponse.json(cache.data, {
      headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=240' },
    });
  }

  const state = await readState();
  // Stored history is chronological (oldest first)
  const history = state.history;

  const pools = await getPoolAddresses();
  const candles: Candle[] = [];
  for (const pool of pools) {
    candles.push(...(await getCandles(pool)));
  }

  // Rate-limited or no data: serve the last good result instead of nulls
  if (candles.length === 0) {
    if (lastGood) {
      cache = { ts: Date.now(), data: lastGood };
      return NextResponse.json(lastGood, {
        headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=240' },
      });
    }
    return NextResponse.json(
      { perfs: {} },
      { headers: { 'Cache-Control': 's-maxage=30' } },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const perfs: Record<string, number | null> = {};
  for (let i = 0; i < history.length; i++) {
    const start = history[i].ts;
    const end = i + 1 < history.length ? history[i + 1].ts : now;
    const p0 = priceAt(candles, start);
    const p1 = priceAt(candles, end);
    perfs[history[i].signature] =
      p0 !== null && p1 !== null && p0 > 0 ? ((p1 - p0) / p0) * 100 : null;
  }

  const payload: SkinsPayload = { perfs };
  cache = { ts: Date.now(), data: payload };
  lastGood = payload;
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=240' },
  });
}
