import { NextResponse } from 'next/server';

export const maxDuration = 30;

/**
 * Serves IPFS content from our own domain so bots/indexers never depend
 * on (rate-limited) public gateways. Content is addressed by CID, so the
 * response is immutable and the Vercel edge cache serves repeats without
 * touching the function.
 */
const GATEWAYS = [
  process.env.PINATA_GATEWAY ? `https://${process.env.PINATA_GATEWAY}` : null,
  'https://gateway.pinata.cloud',
  'https://ipfs.io',
].filter(Boolean) as string[];

const CID_REGEX = /^[a-zA-Z0-9]{40,70}$/;

export async function GET(
  _request: Request,
  { params }: { params: { cid: string } },
) {
  const { cid } = params;
  if (!CID_REGEX.test(cid)) {
    return NextResponse.json({ error: 'Invalid CID.' }, { status: 400 });
  }

  for (const gateway of GATEWAYS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(`${gateway}/ipfs/${cid}`, { signal: controller.signal });
      if (!res.ok) continue;
      const body = await res.arrayBuffer();
      return new NextResponse(body, {
        headers: {
          'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
          // CIDs are content-addressed: safe to cache forever at the edge
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      // try the next gateway
    } finally {
      clearTimeout(timer);
    }
  }

  return NextResponse.json({ error: 'Content unavailable.' }, { status: 502 });
}
