import { NextResponse } from 'next/server';
import { performTouch } from '@/lib/republishCore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Manual/cron trigger for the metadata touch (see lib/republishCore.ts).
// The site's own traffic also paces touches via touchIfDue(); this
// endpoint remains as an external backup and for manual runs.
export async function POST(request: Request) {
  const secret = process.env.REPUBLISH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Republish is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const result = await performTouch();
    if (result.status === 'skipped') {
      return NextResponse.json({ skipped: result.reason }, { status: 202 });
    }
    return NextResponse.json({
      ok: true,
      normalized: result.normalized,
      republished: { name: result.name, symbol: result.symbol, uri: result.uri },
      signature: result.signature,
    });
  } catch (err) {
    console.error('republish error:', err);
    const message = err instanceof Error ? err.message : 'Internal error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
