import fs from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';

/**
 * State storage.
 * - Production (Vercel): Upstash Redis — set UPSTASH_REDIS_REST_URL/TOKEN
 *   (or the KV_REST_API_* variables from the Vercel marketplace integration).
 * - Local dev fallback: JSON file in data/ when Redis is not configured.
 */
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const STATE_KEY = 'chameleon:state';
const LOCK_KEY = 'chameleon:lock';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export interface ChangeRecord {
  name: string;
  symbol: string;
  wallet: string;
  signature: string;
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
  usedSignatures: string[];
  history: ChangeRecord[];
}

const DEFAULT_STATE: TokenState = {
  name: process.env.TOKEN_NAME || 'Chameleon',
  symbol: process.env.TOKEN_SYMBOL || 'CHMLN',
  description:
    'The coin that changes its skin. Burn your tokens to change its name, ticker and image.',
  imageFile: null,
  imageType: null,
  imageUrl: null,
  metadataUri: null,
  lastChangeTs: 0,
  usedSignatures: [],
  history: [],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export async function readState(): Promise<TokenState> {
  if (redis) {
    const stored = await redis.get<TokenState>(STATE_KEY);
    return { ...DEFAULT_STATE, ...(stored ?? {}) };
  }
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    return { ...DEFAULT_STATE };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeState(state: TokenState): Promise<void> {
  if (redis) {
    await redis.set(STATE_KEY, state);
    return;
  }
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// --- Change lock (prevents two changes from processing at once) ---

let memLock = false;

export async function acquireLock(): Promise<boolean> {
  if (redis) {
    const ok = await redis.set(LOCK_KEY, '1', { nx: true, ex: 60 });
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
