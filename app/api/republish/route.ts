import { NextResponse } from 'next/server';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import bs58 from 'bs58';
import { acquireLock, readState, releaseLock } from '@/lib/store';
import { MINT_ADDRESS, RPC_URL } from '@/lib/config';
import { parseSecretKey } from '@/lib/keys';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "Touches" the on-chain metadata by re-writing the CURRENT values.
 * Indexers/bots that dropped the original account-change event get fresh
 * chances to re-index the token. Called by a cron every ~5 minutes;
 * protected by REPUBLISH_SECRET. Never changes what the token looks
 * like: it re-applies exactly what is stored, and skips whenever the
 * on-chain state does not match the stored state (e.g. a change is in
 * flight).
 */
export async function POST(request: Request) {
  const secret = process.env.REPUBLISH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Republish is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!MINT_ADDRESS || !process.env.UPDATE_AUTHORITY_SECRET) {
    return NextResponse.json({ error: 'Token is not configured.' }, { status: 503 });
  }

  // Same lock as /api/change: a touch can never interleave with a change
  if (!(await acquireLock())) {
    return NextResponse.json({ skipped: 'a change is being processed' }, { status: 202 });
  }
  try {
    const state = await readState();
    if (!state.metadataUri || state.history.length === 0) {
      return NextResponse.json({ skipped: 'no pinned metadata yet' }, { status: 202 });
    }

    const umi = createUmi(RPC_URL).use(mplTokenMetadata());
    umi.use(
      keypairIdentity(
        umi.eddsa.createKeypairFromSecretKey(
          parseSecretKey(process.env.UPDATE_AUTHORITY_SECRET),
        ),
      ),
    );
    const mint = publicKey(MINT_ADDRESS);
    const current = await fetchMetadataFromSeeds(umi, { mint });

    // On-chain strings are null-padded to their fixed size
    const clean = (s: string) => s.replace(/\0+/g, '').trim();
    if (
      clean(current.name) !== state.name ||
      clean(current.symbol) !== state.symbol ||
      clean(current.uri) !== state.metadataUri
    ) {
      return NextResponse.json(
        { skipped: 'on-chain metadata differs from stored state' },
        { status: 202 },
      );
    }

    const result = await updateV1(umi, {
      mint,
      authority: umi.identity,
      data: {
        ...current,
        name: state.name,
        symbol: state.symbol,
        uri: state.metadataUri,
      },
    }).sendAndConfirm(umi);

    return NextResponse.json({
      ok: true,
      republished: { name: state.name, symbol: state.symbol },
      signature: bs58.encode(result.signature),
    });
  } catch (err) {
    console.error('republish error:', err);
    const message = err instanceof Error ? err.message : 'Internal error.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseLock();
  }
}
