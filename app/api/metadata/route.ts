import { NextResponse } from 'next/server';
import { readState } from '@/lib/store';
import { BASE_URL, SITE_URL, X_URL } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Fixed token URI: the JSON changes, the address never does.
export async function GET() {
  const state = await readState();
  return NextResponse.json(
    {
      name: state.name,
      symbol: state.symbol,
      description: state.description,
      image:
        state.imageUrl && !state.imageUrl.includes('/api/image')
          ? state.imageUrl
          : `${BASE_URL}/logo.png`,
      external_url: SITE_URL,
      extensions: {
        website: SITE_URL,
        twitter: X_URL,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
