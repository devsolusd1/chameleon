import { NextResponse } from 'next/server';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import bs58 from 'bs58';
import { acquireLock, readState, releaseLock, writeState } from '@/lib/store';
import { BASE_URL, MINT_ADDRESS, RPC_URL, SITE_URL, X_URL } from '@/lib/config';
import { parseSecretKey } from '@/lib/keys';
import { pinataEnabled, pinJson } from '@/lib/pinata';

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

    // On-chain strings are null-padded to their fixed size; the zero-width
    // toggle (below) is also stripped before comparing
    const clean = (s: string) => s.replace(/[​\0]+/g, '').trim();
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

    // Normalization: if the stored URLs still point at an external gateway,
    // convert them to our own /ipfs/<cid> proxy (re-pin the JSON with the
    // proxied image URL and move the on-chain URI to it). Runs once; after
    // that every touch is a plain rewrite.
    let uri = state.metadataUri;
    let normalized = false;
    const cidOf = (url: string | null) =>
      url?.match(/\/ipfs\/([a-zA-Z0-9]{40,70})/)?.[1] ?? null;
    const imageCid = cidOf(state.imageUrl);
    if (pinataEnabled() && !state.metadataUri.startsWith(BASE_URL) && imageCid) {
      const newImageUrl = `${BASE_URL}/ipfs/${imageCid}`;
      uri = await pinJson(
        {
          name: state.name,
          symbol: state.symbol,
          description: state.description,
          image: newImageUrl,
          external_url: SITE_URL,
          extensions: { website: SITE_URL, twitter: X_URL },
        },
        `${state.symbol}-metadata`,
      );
      state.imageUrl = newImageUrl;
      state.metadataUri = uri;
      if (state.history.length > 0) {
        state.history[state.history.length - 1].imageUrl = newImageUrl;
      }
      normalized = true;
    }

    // Cache-buster: indexers only re-fetch the image when name/symbol
    // actually change, so each touch alternates an invisible zero-width
    // space at the end. Visually identical, but the on-chain value differs
    // every 5 minutes. Applied only when it fits the on-chain byte limits
    // (name 32, symbol 10); real changes always write clean values.
    const TOGGLE = '​'; // zero-width space, 3 bytes in UTF-8
    const hadToggle = current.name.includes(TOGGLE);
    let writeName = state.name;
    let writeSymbol = state.symbol;
    if (!hadToggle) {
      if (Buffer.byteLength(state.name, 'utf8') + 3 <= 32) writeName += TOGGLE;
      if (Buffer.byteLength(state.symbol, 'utf8') + 3 <= 10) writeSymbol += TOGGLE;
    }

    const result = await updateV1(umi, {
      mint,
      authority: umi.identity,
      data: {
        ...current,
        name: writeName,
        symbol: writeSymbol,
        uri,
      },
    }).sendAndConfirm(umi);

    if (normalized) {
      await writeState(state);
    }

    return NextResponse.json({
      ok: true,
      normalized,
      republished: { name: state.name, symbol: state.symbol, uri },
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
