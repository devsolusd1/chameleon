import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PublicKey,
} from '@solana/web3.js';
import { BURN_USD, BURN_USD_TOLERANCE, MAX_BURN_TX_AGE_SECONDS, MINT_ADDRESS, RPC_URL } from './config';
import { getTokenPriceUsd } from './price';

export interface BurnVerification {
  ok: boolean;
  error?: string;
  /** temporary condition (price feed / volatility) — worth retrying */
  retryable?: boolean;
  burnedAmount?: bigint;
}

function collectParsedInstructions(tx: ParsedTransactionWithMeta): ParsedInstruction[] {
  const out: ParsedInstruction[] = [];
  for (const ix of tx.transaction.message.instructions) {
    if ('parsed' in ix) out.push(ix as ParsedInstruction);
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if ('parsed' in ix) out.push(ix as ParsedInstruction);
    }
  }
  return out;
}

/**
 * Verifies on-chain that `signature` is a recent, confirmed transaction in
 * which `wallet` burned tokens worth at least BURN_USD (with tolerance for
 * price drift between the client quote and this verification).
 */
export async function verifyBurn(signature: string, wallet: string): Promise<BurnVerification> {
  const connection = new Connection(RPC_URL, 'confirmed');

  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });

  if (!tx) return { ok: false, error: 'Transaction not found. Wait for confirmation and try again.' };
  if (tx.meta?.err) return { ok: false, error: 'The burn transaction failed on-chain.' };

  const now = Math.floor(Date.now() / 1000);
  if (!tx.blockTime || now - tx.blockTime > MAX_BURN_TX_AGE_SECONDS) {
    return { ok: false, error: 'Burn transaction is too old. Make a fresh burn.' };
  }

  // Look for a burn/burnChecked instruction of our mint authorized by the wallet
  let burnedAmount = 0n;
  for (const ix of collectParsedInstructions(tx)) {
    if (ix.program !== 'spl-token') continue;
    const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> };
    if (parsed.type !== 'burn' && parsed.type !== 'burnChecked') continue;
    const info = parsed.info ?? {};
    if (info.mint !== MINT_ADDRESS) continue;
    if (info.authority !== wallet && info.multisigAuthority !== wallet) continue;
    const amountStr =
      (info.tokenAmount as { amount?: string } | undefined)?.amount ??
      (info.amount as string | undefined);
    if (amountStr) burnedAmount += BigInt(amountStr);
  }

  if (burnedAmount === 0n) {
    return { ok: false, error: 'No burn of this token by this wallet was found in the transaction.' };
  }

  // USD-quoted cost: the burned amount must be worth at least BURN_USD
  // (minus tolerance) at the current price
  const decimals = (await connection.getTokenSupply(new PublicKey(MINT_ADDRESS))).value.decimals;
  const priceUsd = await getTokenPriceUsd();
  if (priceUsd === null) {
    return {
      ok: false,
      retryable: true,
      error: 'Price feed unavailable — retrying shortly.',
    };
  }
  const burnedUi = Number(burnedAmount) / 10 ** decimals;
  const burnedUsd = burnedUi * priceUsd;
  if (burnedUsd < BURN_USD * BURN_USD_TOLERANCE) {
    return {
      ok: false,
      // price may bounce back within the burn tx validity window
      retryable: true,
      error: `Insufficient burn: ~$${BURN_USD} worth of tokens is required (your burn is worth ≈$${burnedUsd.toFixed(2)} at the current price).`,
    };
  }

  return { ok: true, burnedAmount };
}
