import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { BURN_PERCENT, MAX_BURN_TX_AGE_SECONDS, MINT_ADDRESS, RPC_URL } from './config';

export interface BurnVerification {
  ok: boolean;
  error?: string;
  burnedAmount?: bigint;
  preBalance?: bigint;
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
 * which `wallet` burned at least BURN_PERCENT% of its balance of the token.
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

  // Balance before the burn (to compute the % burned)
  const pre = tx.meta?.preTokenBalances?.find(
    (b) => b.mint === MINT_ADDRESS && b.owner === wallet,
  );
  if (!pre) {
    return { ok: false, error: 'Could not determine the balance before the burn.' };
  }
  const preBalance = BigInt(pre.uiTokenAmount.amount);
  if (preBalance === 0n) {
    return { ok: false, error: 'The wallet held no tokens before the burn.' };
  }

  // burnedAmount >= preBalance * (BURN_PERCENT/100), with 0.1% rounding tolerance
  const requiredTimes100000 = preBalance * BigInt(Math.round(BURN_PERCENT * 1000));
  const burnedTimes100000 = burnedAmount * 100000n;
  const tolerance = requiredTimes100000 / 1000n;
  if (burnedTimes100000 + tolerance < requiredTimes100000) {
    return {
      ok: false,
      error: `Insufficient burn: you must burn at least ${BURN_PERCENT}% of your balance.`,
    };
  }

  return { ok: true, burnedAmount, preBalance };
}
