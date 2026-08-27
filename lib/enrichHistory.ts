import { Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { RPC_URL } from './config';
import { acquireLock, readState, releaseLock, writeState } from './store';

/**
 * Backfills the `imageUrl` of older history entries: the metadata-update tx
 * carries the era's URI, whose JSON has the image the token wore at the
 * time. Runs at most once per 30s per instance, a few records per pass, and
 * persists results so each record is resolved once.
 */
let lastAttempt = 0;
const MIN_INTERVAL_MS = 30_000;
const MAX_PER_PASS = 5;

type ExtractResult<T> =
  | { value: T } // resolved
  | { value: null; definitive: boolean }; // definitive: stop retrying

async function extractImageFromUpdateTx(
  connection: Connection,
  signature: string,
): Promise<ExtractResult<string>> {
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  // Old tx may have been pruned by the RPC — nothing to resolve, ever
  if (!tx) return { value: null, definitive: true };

  // Collect raw instruction data (legacy and versioned messages)
  const message = tx.transaction.message as unknown as {
    compiledInstructions?: { data: Uint8Array }[];
    instructions?: { data: string }[];
  };
  const blobs: string[] = [];
  if (message.compiledInstructions) {
    for (const ix of message.compiledInstructions) {
      blobs.push(Buffer.from(ix.data).toString('latin1'));
    }
  } else if (message.instructions) {
    for (const ix of message.instructions) {
      blobs.push(Buffer.from(bs58.decode(ix.data)).toString('latin1'));
    }
  }

  // The new URI appears verbatim inside the borsh-encoded update data
  const match = blobs.join('\n').match(/https?:\/\/[\x21-\x7e]+/);
  if (!match || !match[0].includes('/ipfs/')) {
    // No IPFS URI in this update (fixed-URI era) — nothing to resolve
    return { value: null, definitive: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(match[0], { signal: controller.signal });
    // Gateway hiccup/rate limit: transient, retry on a later pass
    if (!res.ok) return { value: null, definitive: false };
    const json = (await res.json()) as { image?: unknown };
    return typeof json.image === 'string'
      ? { value: json.image }
      : { value: null, definitive: true };
  } catch {
    return { value: null, definitive: false };
  } finally {
    clearTimeout(timer);
  }
}


export async function enrichHistoryImages(): Promise<void> {
  const now = Date.now();
  if (now - lastAttempt < MIN_INTERVAL_MS) return;
  lastAttempt = now;

  const state = await readState();
  const missing = state.history
    .filter((h) => h.imageUrl === undefined && h.updateSignature)
    .slice(-MAX_PER_PASS);
  if (missing.length === 0) return;

  const connection = new Connection(RPC_URL, 'confirmed');
  const images = new Map<string, string | null>();

  for (const h of missing) {
    const r = await extractImageFromUpdateTx(connection, h.updateSignature!);
    if (r.value !== null) images.set(h.signature, r.value);
    else if (r.definitive) images.set(h.signature, null);
    await new Promise((res) => setTimeout(res, 400)); // be gentle with APIs
  }
  if (images.size === 0) return;

  // Reuse the change lock so we never clobber a concurrent change's write
  if (!(await acquireLock())) return;
  try {
    const fresh = await readState();
    let dirty = false;
    for (const h of fresh.history) {
      if (h.imageUrl === undefined && images.has(h.signature)) {
        h.imageUrl = images.get(h.signature);
        dirty = true;
      }
    }
    if (dirty) await writeState(fresh);
  } finally {
    await releaseLock();
  }
}
