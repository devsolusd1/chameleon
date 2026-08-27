import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { readState } from '@/lib/store';
import { getTokenPriceUsd } from '@/lib/price';
import { MINT_ADDRESS, RPC_URL } from '@/lib/config';

export const dynamic = 'force-dynamic';

interface StatsPayload {
  totalChanges: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  circulatingSupply: number | null;
}

let cache: { ts: number; data: StatsPayload } | null = null;
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

  const state = await readState();
  const totalChanges = state.totalChanges || state.history.length;

  let circulatingSupply: number | null = null;
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const supply = await connection.getTokenSupply(new PublicKey(MINT_ADDRESS));
    circulatingSupply = supply.value.uiAmount ?? null;
  } catch {
    // leave null
  }

  const priceUsd = await getTokenPriceUsd();
  const marketCapUsd =
    priceUsd !== null && circulatingSupply !== null ? priceUsd * circulatingSupply : null;

  const payload: StatsPayload = { totalChanges, priceUsd, marketCapUsd, circulatingSupply };
  cache = { ts: Date.now(), data: payload };
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
  });
}
