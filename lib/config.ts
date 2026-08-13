export const RPC_URL =
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

export const MINT_ADDRESS = process.env.NEXT_PUBLIC_MINT_ADDRESS || '';

// Fixed cost of a change, in whole tokens
export const BURN_AMOUNT_TOKENS = parseInt(process.env.BURN_AMOUNT || '1000000', 10);

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
