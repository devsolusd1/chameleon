import { Connection, ParsedInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { MINT_ADDRESS, RPC_URL } from './config';
import { acquireLock, readState, releaseLock, writeState } from './store';

/**
 * Backfills per-record data that older history entries are missing:
 * - imageUrl: the metadata-update tx carries the era's URI; its JSON has
 *   the image the token wore at the time.
 * - burnedTokens: parsed from the burn transaction itself.
 * Runs at most once per 30s per instance, a few records per pass, and
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

async function extractBurnedTokens(
  connection: Connection,
  signature: string,
): Promise<ExtractResult<number>> {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return { value: null, definitive: true };

    let total = 0;
    let found = false;
    const scan = (ix: unknown) => {
      const parsed = (ix as ParsedInstruction).parsed as
        | { type?: string; info?: Record<string, unknown> }
        | undefined;
      if (!parsed || (parsed.type !== 'burn' && parsed.type !== 'burnChecked')) return;
      const info = parsed.info ?? {};
      if (info.mint !== MINT_ADDRESS) return;
      found = true;
      const tokenAmount = info.tokenAmount as
        | { uiAmount?: number; amount?: string }
        | undefined;
      if (typeof tokenAmount?.uiAmount === 'number') {
        total += tokenAmount.uiAmount;
      } else {
        const raw = tokenAmount?.amount ?? (info.amount as string | undefined);
        if (raw) total += Number(raw) / 1e6;
      }
    };
    for (const ix of tx.transaction.message.instructions) scan(ix);
    for (const inner of tx.meta?.innerInstructions ?? []) {
      for (const ix of inner.instructions) scan(ix);
    }
    return found ? { value: total } : { value: null, definitive: true };
  } catch {
    return { value: null, definitive: false };
  }
}

export async function enrichHistoryImages(): Promise<void> {
  const now = Date.now();
  if (now - lastAttempt < MIN_INTERVAL_MS) return;
  lastAttempt = now;

  const state = await readState();
  const missing = state.history
    .filter(
      (h) =>
        (h.imageUrl === undefined && h.updateSignature) || h.burnedTokens === undefined,
    )
    .slice(-MAX_PER_PASS);
  if (missing.length === 0) return;

  const connection = new Connection(RPC_URL, 'confirmed');
  const images = new Map<string, string | null>();
  const burns = new Map<string, number | null>();

  for (const h of missing) {
    if (h.imageUrl === undefined && h.updateSignature) {
      const r = await extractImageFromUpdateTx(connection, h.updateSignature);
      if (r.value !== null) images.set(h.signature, r.value);
      else if (r.definitive) images.set(h.signature, null);
    }
    if (h.burnedTokens === undefined) {
      const r = await extractBurnedTokens(connection, h.signature);
      if (r.value !== null) burns.set(h.signature, r.value);
      else if (r.definitive) burns.set(h.signature, null);
    }
    await new Promise((res) => setTimeout(res, 400)); // be gentle with APIs
  }
  if (images.size === 0 && burns.size === 0) return;

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
      if (h.burnedTokens === undefined && burns.has(h.signature)) {
        h.burnedTokens = burns.get(h.signature);
        dirty = true;
      }
    }
    if (dirty) await writeState(fresh);
  } finally {
    await releaseLock();
  }
}
