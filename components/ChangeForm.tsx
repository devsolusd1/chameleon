'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';

// Rendered client-side only: the wallet button's markup depends on wallet
// state that doesn't exist during SSR (avoids hydration mismatch)
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton),
  { ssr: false },
);
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import type { SiteState } from '@/app/page';

type Props = {
  state: SiteState | null;
  onChanged: () => void;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; msg: string }
  | { kind: 'ok'; msg: string; link?: string }
  | { kind: 'err'; msg: string };

export default function ChangeForm({ state, onChanged }: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [decimals, setDecimals] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [cooldown, setCooldown] = useState(0);

  const mint = state?.mint || '';
  const burnPercent = state?.burnPercent ?? 0.1;

  // Local cooldown countdown, synced with the server
  useEffect(() => {
    setCooldown(state?.cooldownRemaining ?? 0);
  }, [state?.cooldownRemaining]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the holder's balance
  const loadBalance = useCallback(async () => {
    if (!publicKey || !mint) {
      setBalance(null);
      return;
    }
    try {
      const mintPk = new PublicKey(mint);
      const mintInfo = await getMint(connection, mintPk);
      setDecimals(mintInfo.decimals);
      const ata = getAssociatedTokenAddressSync(mintPk, publicKey);
      const bal = await connection.getTokenAccountBalance(ata);
      setBalance(BigInt(bal.value.amount));
    } catch {
      setBalance(0n);
    }
  }, [publicKey, mint, connection]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const burnAmount = useMemo(() => {
    if (balance === null || balance === 0n) return 0n;
    // percentage with 3 decimal places of precision, rounding UP
    // so the server-side check always passes
    const num = balance * BigInt(Math.round(burnPercent * 1000));
    return (num + 99999n) / 100000n;
  }, [balance, burnPercent]);

  const fmt = useCallback(
    (raw: bigint) => {
      if (decimals === null) return raw.toString();
      const s = raw.toString().padStart(decimals + 1, '0');
      const int = s.slice(0, -decimals) || '0';
      const frac = decimals > 0 ? s.slice(-decimals).replace(/0+$/, '') : '';
      return frac ? `${int}.${frac}` : int;
    },
    [decimals],
  );

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setImageFile(f);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!publicKey || !mint || decimals === null) return;
    if (!name.trim() || !symbol.trim()) {
      setStatus({ kind: 'err', msg: 'Fill in the new name and the new ticker.' });
      return;
    }
    if (burnAmount === 0n) {
      setStatus({ kind: 'err', msg: 'You do not have enough tokens to burn.' });
      return;
    }

    setBusy(true);
    try {
      // 1) Burn X% of the balance
      setStatus({ kind: 'info', msg: `Approve the burn of ${fmt(burnAmount)} tokens in your wallet...` });
      const mintPk = new PublicKey(mint);
      const ata = getAssociatedTokenAddressSync(mintPk, publicKey);
      const ix = createBurnCheckedInstruction(ata, mintPk, publicKey, burnAmount, decimals);
      const tx = new Transaction().add(ix);
      const latest = await connection.getLatestBlockhash();
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);

      setStatus({ kind: 'info', msg: 'Burn sent. Waiting for on-chain confirmation...' });
      await connection.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        'confirmed',
      );

      // 2) Submit the form with proof of the burn
      setStatus({ kind: 'info', msg: 'Burn confirmed! Updating the token metadata...' });
      const form = new FormData();
      form.set('wallet', publicKey.toBase58());
      form.set('signature', signature);
      form.set('name', name.trim());
      form.set('symbol', symbol.trim().toUpperCase());
      if (imageFile) form.set('image', imageFile);

      const res = await fetch('/api/change', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        setStatus({ kind: 'err', msg: data.error || 'Failed to update the metadata.' });
        return;
      }

      setStatus({
        kind: 'ok',
        msg: `Done! The token is now ${data.name} ($${data.symbol}).`,
        link: data.explorer,
      });
      setName('');
      setSymbol('');
      setImageFile(null);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
      onChanged();
      loadBalance();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error.';
      setStatus({ kind: 'err', msg });
    } finally {
      setBusy(false);
    }
  };

  const notLaunched = !mint;
  const inCooldown = cooldown > 0;

  return (
    <div className="form-box">
      {inCooldown && (
        <div className="cooldown-banner">
          🕒 Cooldown active — next change in {Math.floor(cooldown / 60)}:
          {String(cooldown % 60).padStart(2, '0')}
        </div>
      )}

      <WalletMultiButton />

      {notLaunched && (
        <div className="status info">The token has not launched yet. Check back soon!</div>
      )}

      {connected && !notLaunched && (
        <div className="form-grid">
          <div className="burn-info">
            {balance === null ? (
              'Loading your balance...'
            ) : balance === 0n ? (
              <>You don&apos;t hold this token. Grab some to be able to change its skin.</>
            ) : (
              <>
                Your balance: <strong>{fmt(balance)}</strong> — required burn (
                {burnPercent}%): <strong>{fmt(burnAmount)}</strong>
              </>
            )}
          </div>

          <div className="field">
            <label htmlFor="name">New name</label>
            <input
              id="name"
              type="text"
              maxLength={32}
              placeholder="e.g. Supreme Chameleon"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="hint">Up to 32 characters.</div>
          </div>

          <div className="field">
            <label htmlFor="symbol">New ticker</label>
            <input
              id="symbol"
              type="text"
              maxLength={10}
              placeholder="e.g. CHAM"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
            <div className="hint">Up to 10 characters, letters and numbers only.</div>
          </div>

          <div className="field">
            <label htmlFor="image">New image (optional)</label>
            <input id="image" type="file" accept="image/png,image/jpeg,image/gif" onChange={onPickImage} />
            <div className="hint">PNG, JPEG or GIF, up to 2 MB. Leave empty to keep the current image.</div>
            {imagePreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="image-preview" src={imagePreview} alt="New image preview" />
            )}
          </div>

          <div>
            <button
              className="btn"
              onClick={submit}
              disabled={busy || inCooldown || balance === 0n || balance === null}
            >
              {busy
                ? 'Processing...'
                : inCooldown
                  ? 'Wait for the cooldown'
                  : `🔥 Burn ${burnPercent}% and change the token`}
            </button>
          </div>
        </div>
      )}

      {status.kind !== 'idle' && (
        <div className={`status ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : 'info'}`}>
          {status.msg}{' '}
          {status.kind === 'ok' && status.link && (
            <a href={status.link} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </div>
      )}
    </div>
  );
}
