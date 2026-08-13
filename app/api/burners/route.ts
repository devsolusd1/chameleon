import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Top wallets by tokens burned (amounts backfilled from burn txs)
export async function GET() {
  const state = await readState();

  const byWallet = new Map<string, { tokens: number; changes: number }>();
  for (const h of state.history) {
    const entry = byWallet.get(h.wallet) ?? { tokens: 0, changes: 0 };
    entry.tokens += h.burnedTokens ?? 0;
    entry.changes += 1;
    byWallet.set(h.wallet, entry);
  }

  const top = [...byWallet.entries()]
    .map(([wallet, v]) => ({ wallet, tokens: v.tokens, changes: v.changes }))
    .sort((a, b) => b.tokens - a.tokens || b.changes - a.changes)
    .slice(0, 3);

  return NextResponse.json(
    { top },
    { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } },
  );
}
