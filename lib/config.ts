export const RPC_URL =
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

export const MINT_ADDRESS = process.env.NEXT_PUBLIC_MINT_ADDRESS || '';

// Cost of a change in USD — the token amount is quoted at burn time
export const BURN_USD = parseFloat(process.env.BURN_USD || '50');

// Server-side tolerance: accepts burns worth at least this fraction of
// BURN_USD (absorbs price drift between the client quote and verification)
export const BURN_USD_TOLERANCE = 0.85;

export const COOLDOWN_SECONDS = parseInt(process.env.COOLDOWN_SECONDS || '120', 10);

export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// Fixed official website — shown in the metadata, never changes
export const SITE_URL = process.env.SITE_URL || BASE_URL;

// Official X (Twitter) profile — shown on the site and in the metadata
export const X_URL = 'https://x.com/chameleonsol';

// Maximum accepted age for the burn transaction (prevents reuse of old txs)
export const MAX_BURN_TX_AGE_SECONDS = 15 * 60;

// Form limits (Metaplex allows name up to 32 / symbol up to 10)
export const MAX_NAME_LENGTH = 15;
export const MAX_SYMBOL_LENGTH = 10;

// Letters and numbers only; name may have single spaces between words
export const NAME_REGEX = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/;
export const SYMBOL_REGEX = /^[A-Za-z0-9]+$/;
