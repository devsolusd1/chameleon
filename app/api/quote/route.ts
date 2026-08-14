import { NextResponse } from 'next/server';
import { getTokenPriceUsd } from '@/lib/price';
import { BURN_USD, MINT_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Live quote: how many tokens are worth BURN_USD right now
export async function GET() {
  if (!MINT_ADDRESS) {
    return NextResponse.json({ error: 'Token not configured.' }, { status: 500 });
  }
  const priceUsd = await getTokenPriceUsd();
  if (priceUsd === null) {
    return NextResponse.json(
      { error: 'Price feed unavailable. Try again shortly.' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      burnUsd: BURN_USD,
      priceUsd,
      tokensToBurn: Math.ceil(BURN_USD / priceUsd),
    },
    { headers: { 'Cache-Control': 's-maxage=20, stale-while-revalidate=40' } },
  );
}
