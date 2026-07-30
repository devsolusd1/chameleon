export const RPC_URL =
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

export const MINT_ADDRESS = process.env.NEXT_PUBLIC_MINT_ADDRESS || '';

export const BURN_PERCENT = parseFloat(process.env.BURN_PERCENT || '0.1');

export const COOLDOWN_SECONDS = parseInt(process.env.COOLDOWN_SECONDS || '120', 10);

export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// Fixed official website — shown in the metadata, never changes
export const SITE_URL = process.env.SITE_URL || BASE_URL;

// Official X (Twitter) profile — shown on the site and in the metadata
export const X_URL = 'https://x.com/chameleonsol';

// Maximum accepted age for the burn transaction (prevents reuse of old txs)
export const MAX_BURN_TX_AGE_SECONDS = 15 * 60;

// Metaplex Token Metadata limits
export const MAX_NAME_LENGTH = 32;
export const MAX_SYMBOL_LENGTH = 10;
