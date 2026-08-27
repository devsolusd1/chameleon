import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import bs58 from 'bs58';
import { acquireLock, readState, releaseLock, tryMarkTouch, writeState } from './store';
import { BASE_URL, MINT_ADDRESS, RPC_URL, SITE_URL, X_URL } from './config';
import { parseSecretKey } from './keys';
import { pinataEnabled, pinJson } from './pinata';

export interface TouchResult {
  status: 'ok' | 'skipped';
  reason?: string;
  normalized?: boolean;
  signature?: string;
  name?: string;
  symbol?: string;
  uri?: string;
}

/**
 * "Touches" the on-chain metadata: re-writes the CURRENT values with an
 * alternating invisible zero-width suffix so indexers see a change and
 * re-fetch everything (including the image). Also normalizes legacy
 * gateway URLs to our /ipfs proxy on first run. Never interleaves with a
 * real change (shared lock) and skips when on-chain differs from stored
 * state.
 */
export async function performTouch(): Promise<TouchResult> {
  if (!MINT_ADDRESS || !process.env.UPDATE_AUTHORITY_SECRET) {
    return { status: 'skipped', reason: 'token not configured' };
  }
  if (!(await acquireLock())) {
    return { status: 'skipped', reason: 'a change is being processed' };
  }
  try {
    const state = await readState();
    if (!state.metadataUri || state.history.length === 0) {
      return { status: 'skipped', reason: 'no pinned metadata yet' };
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

    // On-chain strings are null-padded; the zero-width toggle is stripped
    // before comparing
    const clean = (s: string) => s.replace(/[​\0]+/g, '').trim();
    if (
      clean(current.name) !== state.name ||
      clean(current.symbol) !== state.symbol ||
      clean(current.uri) !== state.metadataUri
    ) {
      return { status: 'skipped', reason: 'on-chain metadata differs from stored state' };
    }

    // Normalization: convert legacy gateway URLs to our /ipfs proxy once
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

    // Cache-buster: alternate an invisible zero-width space so indexers
    // treat every touch as a name/symbol change (within byte limits)
    const TOGGLE = '​';
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

    return {
      status: 'ok',
      normalized,
      name: state.name,
      symbol: state.symbol,
      uri,
      signature: bs58.encode(result.signature),
    };
  } finally {
    await releaseLock();
  }
}

/**
 * Traffic-driven pacing: called opportunistically (e.g. from /api/state on
 * every visitor poll) and performs at most one touch per interval across
 * all serverless instances. Failures are swallowed — the next window
 * retries.
 */
const TOUCH_INTERVAL_SECONDS = 300;
// In-memory pre-gate: avoids hitting Redis (tryMarkTouch) on every single
// poll. Each instance only consults the shared Redis gate at most once per
// this window, cutting Redis writes from per-request to rare.
const LOCAL_TOUCH_GAP_MS = 240_000;
let lastLocalTouchAttempt = 0;

export async function touchIfDue(): Promise<void> {
  try {
    // Automatic metadata touches are DISABLED. Set AUTO_REPUBLISH=on to
    // re-enable the traffic-driven pacing.
    if (process.env.AUTO_REPUBLISH !== 'on') return;
    if (!MINT_ADDRESS || !process.env.UPDATE_AUTHORITY_SECRET) return;
    // Cheap local throttle before touching Redis at all
    const now = Date.now();
    if (now - lastLocalTouchAttempt < LOCAL_TOUCH_GAP_MS) return;
    lastLocalTouchAttempt = now;
    // Shared cross-instance gate (one touch per interval globally)
    if (!(await tryMarkTouch(TOUCH_INTERVAL_SECONDS))) return;
    await performTouch();
  } catch (err) {
    console.error('auto-touch error:', err);
  }
}
