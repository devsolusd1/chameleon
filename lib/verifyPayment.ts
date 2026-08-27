import { Connection, ParsedInstruction, ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  MAX_PAYMENT_TX_AGE_SECONDS,
  PAY_TO_WALLET,
  PAY_USD,
  PAY_USD_TOLERANCE,
  RPC_URL,
} from './config';
import { getSolPriceUsd } from './price';

export interface PaymentVerification {
  ok: boolean;
  error?: string;
  /** temporary condition (price feed / volatility) — worth retrying */
  retryable?: boolean;
  lamports?: bigint;
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
 * which `wallet` transferred SOL worth at least PAY_USD to PAY_TO_WALLET
 * (with tolerance for SOL price drift between the client quote and this
 * verification).
 */
export async function verifyPayment(
  signature: string,
  wallet: string,
): Promise<PaymentVerification> {
  const connection = new Connection(RPC_URL, 'confirmed');

  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });

  if (!tx) return { ok: false, error: 'Transaction not found. Wait for confirmation and try again.' };
  if (tx.meta?.err) return { ok: false, error: 'The payment transaction failed on-chain.' };

  const now = Math.floor(Date.now() / 1000);
  if (!tx.blockTime || now - tx.blockTime > MAX_PAYMENT_TX_AGE_SECONDS) {
    return { ok: false, error: 'Payment transaction is too old. Make a fresh payment.' };
  }

  // Sum native SOL transfers from `wallet` to PAY_TO_WALLET
  let lamports = 0n;
  for (const ix of collectParsedInstructions(tx)) {
    if (ix.program !== 'system') continue;
    const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> };
    if (parsed.type !== 'transfer' && parsed.type !== 'transferWithSeed') continue;
    const info = parsed.info ?? {};
    if (info.source !== wallet || info.destination !== PAY_TO_WALLET) continue;
    const amount = info.lamports as number | string | undefined;
    if (amount != null) lamports += BigInt(amount);
  }

  if (lamports === 0n) {
    return {
      ok: false,
      error: 'No SOL payment from this wallet to the Chameleon wallet was found in the transaction.',
    };
  }

  // USD check: the paid SOL must be worth at least PAY_USD (minus tolerance)
  const solPriceUsd = await getSolPriceUsd();
  if (solPriceUsd === null) {
    return { ok: false, retryable: true, error: 'Price feed unavailable — retrying shortly.' };
  }
  const paidSol = Number(lamports) / 1e9;
  const paidUsd = paidSol * solPriceUsd;
  if (paidUsd < PAY_USD * PAY_USD_TOLERANCE) {
    return {
      ok: false,
      retryable: true,
      error: `Insufficient payment: ~$${PAY_USD} in SOL is required (your payment is worth ≈$${paidUsd.toFixed(2)} at the current SOL price).`,
    };
  }

  return { ok: true, lamports };
}
