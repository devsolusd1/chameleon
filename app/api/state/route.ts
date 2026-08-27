import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { readState } from '@/lib/store';
import { enrichHistoryImages } from '@/lib/enrichHistory';
import { touchIfDue } from '@/lib/republishCore';
import { PAY_USD, PAY_TO_WALLET, COOLDOWN_SECONDS, MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  // Traffic-driven metadata touch: visitor polls pace the republish to at
  // most once per interval, without delaying this response
  const touch = touchIfDue();
  try {
    waitUntil(touch);
  } catch {
    touch.catch(() => {});
  }

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
      payUsd: PAY_USD,
      payToWallet: PAY_TO_WALLET,
      cooldownSeconds: COOLDOWN_SECONDS,
      cooldownRemaining,
      history: state.history.slice(-10).reverse(),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
