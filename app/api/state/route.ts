import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';
import { enrichHistoryImages } from '@/lib/enrichHistory';
import { BURN_AMOUNT_TOKENS, COOLDOWN_SECONDS, MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Best-effort backfill of historical skin images (throttled, one-time per record)
  try {
    await enrichHistoryImages();
  } catch {
    // never let enrichment break the state endpoint
  }
  const state = await readState();
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - state.lastChangeTs;
  const cooldownRemaining = state.lastChangeTs > 0 ? Math.max(0, COOLDOWN_SECONDS - elapsed) : 0;

  return NextResponse.json(
    {
      name: state.name,
      symbol: state.symbol,
      description: state.description,
      mint: MINT_ADDRESS,
      burnAmount: BURN_AMOUNT_TOKENS,
      cooldownSeconds: COOLDOWN_SECONDS,
      cooldownRemaining,
      history: state.history.slice(-10).reverse(),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
