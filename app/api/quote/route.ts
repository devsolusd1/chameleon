import { NextResponse } from 'next/server';
import { PAY_SOL, PAY_TO_WALLET, MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Fixed cost in SOL and the wallet that receives it
export async function GET() {
  if (!MINT_ADDRESS) {
    return NextResponse.json({ error: 'Token not configured.' }, { status: 500 });
  }
  return NextResponse.json(
    {
      paySol: PAY_SOL,
      payToWallet: PAY_TO_WALLET,
    },
    { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' } },
  );
}
