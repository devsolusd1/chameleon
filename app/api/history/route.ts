import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';
import { MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Full skin archive (the store keeps the last ~100 changes)
export async function GET() {
  const state = await readState();
  return NextResponse.json(
    {
      name: state.name,
      symbol: state.symbol,
      mint: MINT_ADDRESS,
      history: [...state.history].reverse(), // newest first
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
