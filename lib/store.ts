import fs from 'fs';
import path from 'path';

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

export function readState(): TokenState {
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

export function writeState(state: TokenState) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function saveImage(buffer: Buffer, mimeType: string): string {
  ensureDataDir();
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : 'jpg';
  const filename = `token-image.${ext}`;
  fs.writeFileSync(path.join(DATA_DIR, filename), buffer);
  return filename;
}

export function readImage(filename: string): Buffer | null {
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}
