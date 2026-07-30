import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';
import { BURN_PERCENT, COOLDOWN_SECONDS, MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
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
      burnPercent: BURN_PERCENT,
      cooldownSeconds: COOLDOWN_SECONDS,
      cooldownRemaining,
      history: state.history.slice(-10).reverse(),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
