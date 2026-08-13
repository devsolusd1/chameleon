import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { MINT_ADDRESS, RPC_URL } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Total supply the token was created with (DBC default: 1B)
const INITIAL_SUPPLY = parseFloat(process.env.INITIAL_SUPPLY || '1000000000');

interface BurnedPayload {
  initialSupply: number;
  currentSupply: number;
  burned: number;
  burnedPercent: number;
  priceUsd: number | null;
  burnedValueUsd: number | null;
}

// Cached per serverless instance; Cache-Control handles the edge
let cache: { ts: number; data: BurnedPayload } | null = null;
const CACHE_MS = 60_000;

export async function GET() {
  if (!MINT_ADDRESS) {
    return NextResponse.json({ error: 'Token not configured.' }, { status: 500 });
  }

  if (cache && Date.now() - cache.ts < CACHE_MS) {
    return NextResponse.json(cache.data, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
    });
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const supply = await connection.getTokenSupply(new PublicKey(MINT_ADDRESS));
  const currentSupply = supply.value.uiAmount ?? 0;
  const burned = Math.max(0, INITIAL_SUPPLY - currentSupply);
  const burnedPercent = (burned / INITIAL_SUPPLY) * 100;

  // Current price in USD from DexScreener (keyless public API);
  // picks the pair with the deepest liquidity
  let priceUsd: number | null = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT_ADDRESS}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[];
      };
      const pairs = (data.pairs ?? []).filter((p) => p.priceUsd);
      if (pairs.length > 0) {
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        priceUsd = parseFloat(pairs[0].priceUsd!);
      }
    }
  } catch {
    // price stays null; the UI shows the burn amount without a value
  }

  const payload: BurnedPayload = {
    initialSupply: INITIAL_SUPPLY,
    currentSupply,
    burned,
    burnedPercent,
    priceUsd,
    burnedValueUsd: priceUsd !== null ? burned * priceUsd : null,
  };
  cache = { ts: Date.now(), data: payload };

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
  });
}
