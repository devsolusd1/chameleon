import { NextResponse } from 'next/server';
import { getSolPriceUsd } from '@/lib/price';
import { PAY_USD, PAY_TO_WALLET, MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Live quote: how much SOL equals PAY_USD right now
export async function GET() {
  if (!MINT_ADDRESS) {
    return NextResponse.json({ error: 'Token not configured.' }, { status: 500 });
  }
  const solPriceUsd = await getSolPriceUsd();
  if (solPriceUsd === null) {
    return NextResponse.json(
      { error: 'Price feed unavailable. Try again shortly.' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      payUsd: PAY_USD,
      solPriceUsd,
      solToPay: PAY_USD / solPriceUsd,
      payToWallet: PAY_TO_WALLET,
    },
    { headers: { 'Cache-Control': 's-maxage=20, stale-while-revalidate=40' } },
  );
}
