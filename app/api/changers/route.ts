import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Top wallets by number of skin changes made
export async function GET() {
  const state = await readState();

  const byWallet = new Map<string, number>();
  for (const h of state.history) {
    byWallet.set(h.wallet, (byWallet.get(h.wallet) ?? 0) + 1);
  }

  const top = [...byWallet.entries()]
    .map(([wallet, changes]) => ({ wallet, changes }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 3);

  return NextResponse.json(
    { top },
    { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } },
  );
}
