import fs from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';
import { MINT_ADDRESS } from './config';

/**
 * State storage.
 * - Production (Vercel): Upstash Redis — set UPSTASH_REDIS_REST_URL/TOKEN
 *   (or the KV_REST_API_* variables from the Vercel marketplace integration).
 * - Local dev fallback: JSON file in data/ when Redis is not configured.
 */
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function createRedis(): Redis | null {
  if (!redisUrl || !redisToken) return null;
  try {
    return new Redis({ url: redisUrl, token: redisToken });
  } catch (err) {
    console.error('Failed to initialize Redis client:', err);
    return null;
  }
}
const redis = createRedis();

// State is namespaced by mint: switching to a new token (new
// NEXT_PUBLIC_MINT_ADDRESS) automatically starts with a clean slate.
const NS = MINT_ADDRESS || 'default';
const STATE_KEY = `chameleon:state:${NS}`;
const LOCK_KEY = `chameleon:lock:${NS}`;

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, `state.${NS}.json`);

export interface ChangeRecord {
  name: string;
  symbol: string;
  wallet: string;
  /** payment transaction signature */
  signature: string;
  /** metadata update transaction signature */
  updateSignature?: string;
  /** image the token wore during this change (IPFS/gateway URL) */
  imageUrl?: string | null;
  ts: number;
}

export interface TokenState {
  name: string;
  symbol: string;
  description: string;
  imageFile: string | null;
  imageType: string | null;
  /** IPFS/gateway URL of the current image (Pinata mode) */
  imageUrl: string | null;
  /** IPFS/gateway URL of the current metadata JSON (Pinata mode) */
  metadataUri: string | null;
  lastChangeTs: number;
  /** running count of all changes ever (history is capped, this is not) */
  totalChanges: number;
  usedSignatures: string[];
  history: ChangeRecord[];
}

const DEFAULT_STATE: TokenState = {
  name: process.env.TOKEN_NAME || 'Chameleon',
  symbol: process.env.TOKEN_SYMBOL || 'CHMLN',
  description:
    'The coin that changes its skin. Pay to change its name, ticker and image — the website never changes.',
  imageFile: null,
  imageType: null,
  imageUrl: null,
  metadataUri: null,
  lastChangeTs: 0,
  totalChanges: 0,
  usedSignatures: [],
  history: [],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Short in-memory cache: collapses the many per-poll reads (every visitor
// hits /api/state, /api/metadata, /api/image, /api/burned... every few
// seconds) into at most one Redis GET per instance per STATE_TTL_MS. Keeps
// Redis command volume far below plan limits. Slightly stale reads (≤ a few
// seconds) are fine — the UI already polls on an interval.
const STATE_TTL_MS = 8000;
let stateCache: { ts: number; state: TokenState } | null = null;

export async function readState(): Promise<TokenState> {
  if (redis) {
    if (stateCache && Date.now() - stateCache.ts < STATE_TTL_MS) {
      return stateCache.state;
    }
    const stored = await redis.get<TokenState>(STATE_KEY);
    const state = { ...DEFAULT_STATE, ...(stored ?? {}) };
    stateCache = { ts: Date.now(), state };
    return state;
  }
  // File fallback — never throws (read-only filesystems just get defaults)
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE };
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeState(state: TokenState): Promise<void> {
  if (redis) {
    await redis.set(STATE_KEY, state);
    stateCache = { ts: Date.now(), state }; // keep the cache fresh
    return;
  }
  try {
    ensureDataDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    throw new Error(
      'State storage is not configured: connect the Upstash Redis integration (Vercel → Storage tab) and redeploy.',
    );
  }
}

// --- Traffic-driven touch gate: returns true at most once per TTL window
//     across all instances (used to pace the metadata republish) ---

const TOUCH_KEY = `chameleon:touch:${NS}`;
let memTouchTs = 0;

export async function tryMarkTouch(ttlSeconds: number): Promise<boolean> {
  if (redis) {
    const ok = await redis.set(TOUCH_KEY, '1', { nx: true, ex: ttlSeconds });
    return ok === 'OK';
  }
  const now = Date.now();
  if (now - memTouchTs < ttlSeconds * 1000) return false;
  memTouchTs = now;
  return true;
}

// --- Change lock (prevents two changes from processing at once) ---

let memLock = false;

export async function acquireLock(): Promise<boolean> {
  if (redis) {
    // TTL covers slow on-chain confirmations; auto-expires if a change crashes
    const ok = await redis.set(LOCK_KEY, '1', { nx: true, ex: 120 });
    return ok === 'OK';
  }
  if (memLock) return false;
  memLock = true;
  return true;
}

export async function releaseLock(): Promise<void> {
  if (redis) {
    await redis.del(LOCK_KEY);
    return;
  }
  memLock = false;
}

// --- Local image storage (dev fallback; production uses Pinata/IPFS) ---

export function saveImage(buffer: Buffer, mimeType: string): string | null {
  try {
    ensureDataDir();
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : 'jpg';
    const filename = `token-image.${ext}`;
    fs.writeFileSync(path.join(DATA_DIR, filename), buffer);
    return filename;
  } catch {
    // Read-only filesystem (Vercel): fine, the image lives on IPFS
    return null;
  }
}

export function readImage(filename: string): Buffer | null {
  try {
    const file = path.join(DATA_DIR, filename);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}
