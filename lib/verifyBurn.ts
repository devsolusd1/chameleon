import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PublicKey,
} from '@solana/web3.js';
import { BURN_AMOUNT_TOKENS, MAX_BURN_TX_AGE_SECONDS, MINT_ADDRESS, RPC_URL } from './config';

export interface BurnVerification {
  ok: boolean;
  error?: string;
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
 * which `wallet` burned at least BURN_AMOUNT_TOKENS whole tokens.
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

  // Fixed cost: BURN_AMOUNT_TOKENS whole tokens
  const decimals = (await connection.getTokenSupply(new PublicKey(MINT_ADDRESS))).value.decimals;
  const requiredRaw = BigInt(BURN_AMOUNT_TOKENS) * 10n ** BigInt(decimals);
  if (burnedAmount < requiredRaw) {
    return {
      ok: false,
      error: `Insufficient burn: changing the token requires burning ${BURN_AMOUNT_TOKENS.toLocaleString('en-US')} tokens.`,
    };
  }

  return { ok: true, burnedAmount };
}
