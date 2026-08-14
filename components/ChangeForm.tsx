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
  | { kind: 'ok'; msg: string; link?: string; shareText?: string }
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
  const burnTokens = state?.burnAmount ?? 1_000_000;
  const burnTokensFmt = burnTokens.toLocaleString('en-US');

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

  // Fixed cost of a change: burnTokens whole tokens
  const burnAmount = useMemo(() => {
    if (decimals === null) return 0n;
    return BigInt(burnTokens) * 10n ** BigInt(decimals);
  }, [burnTokens, decimals]);

  const insufficient = balance !== null && burnAmount > 0n && balance < burnAmount;

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
    const cleanName = name.trim();
    const cleanSymbol = symbol.trim();
    // Validate BEFORE burning so nobody wastes a burn on invalid input
    if (!/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/.test(cleanName) || cleanName.length > 15) {
      setStatus({ kind: 'err', msg: 'Invalid name: up to 15 characters, letters and numbers only.' });
      return;
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(cleanSymbol)) {
      setStatus({ kind: 'err', msg: 'Invalid ticker: up to 10 characters, letters and numbers only.' });
      return;
    }
    // Validate the image BEFORE burning — a rejected image after the burn
    // would waste the holder's tokens
    if (imageFile) {
      if (!['image/png', 'image/jpeg', 'image/gif'].includes(imageFile.type)) {
        setStatus({ kind: 'err', msg: 'Image must be PNG, JPEG or GIF.' });
        return;
      }
      if (imageFile.size > 2 * 1024 * 1024) {
        setStatus({
          kind: 'err',
          msg: `Image too large: ${(imageFile.size / 1024 / 1024).toFixed(1)} MB (2 MB max). Compress it and try again — no tokens were burned.`,
        });
        return;
      }
    }
    if (burnAmount === 0n) {
      setStatus({ kind: 'err', msg: 'Could not determine the burn amount. Reload and try again.' });
      return;
    }
    if (balance === null || balance < burnAmount) {
      setStatus({
        kind: 'err',
        msg: `Insufficient balance: changing the token costs ${burnTokensFmt} tokens.`,
      });
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

      // 2) Submit the form with proof of the burn. If another change won
      // the slot (cooldown/lock), retry automatically — the burn signature
      // stays valid for ~15 minutes, so it is never wasted.
      setStatus({ kind: 'info', msg: 'Burn confirmed! Updating the token metadata...' });
      const form = new FormData();
      form.set('wallet', publicKey.toBase58());
      form.set('signature', signature);
      form.set('name', cleanName);
      form.set('symbol', cleanSymbol);
      if (imageFile) form.set('image', imageFile);

      let attempt = 0;
      for (;;) {
        const res = await fetch('/api/change', { method: 'POST', body: form });
        const data = await res.json();

        if (res.ok) {
          setStatus({
            kind: 'ok',
            msg: `Done! The token is now ${data.name} ($${data.symbol}).`,
            link: data.explorer,
            shareText: `I just burned ${burnTokensFmt} tokens to give the chameleon a new skin: ${data.name} ($${data.symbol}) 🦎`,
          });
          setName('');
          setSymbol('');
          setImageFile(null);
          if (imagePreview) URL.revokeObjectURL(imagePreview);
          setImagePreview(null);
          onChanged();
          loadBalance();
          break;
        }

        // 429 with retryAfter = temporary (cooldown or another change in
        // flight). Keep retrying up to ~13 min of total burn-tx validity.
        if (res.status === 429 && typeof data.retryAfter === 'number' && attempt < 15) {
          attempt++;
          const wait = Math.min(Math.max(data.retryAfter, 2), 150);
          setStatus({
            kind: 'info',
            msg: `${data.error} Your burn is safe — submitting again automatically in ${wait}s. Keep this page open.`,
          });
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }

        setStatus({ kind: 'err', msg: data.error || 'Failed to update the metadata.' });
        break;
      }
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
      {notLaunched ? (
        <div className="status info">The token has not launched yet. Check back soon!</div>
      ) : inCooldown ? (
        <div className="cooldown-wait">
          <div className="cooldown-label">Cooldown active</div>
          <div className="cooldown-time">
            {Math.floor(cooldown / 60)}:{String(cooldown % 60).padStart(2, '0')}
          </div>
          <p>The token was just changed. The form unlocks when the countdown ends.</p>
        </div>
      ) : (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">New name</label>
            <input
              id="name"
              type="text"
              maxLength={15}
              placeholder="e.g. King Chameleon"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9 ]/g, ''))}
            />
            <div className="hint">Up to 15 characters, letters and numbers only.</div>
          </div>

          <div className="field">
            <label htmlFor="symbol">New ticker</label>
            <input
              id="symbol"
              type="text"
              maxLength={10}
              placeholder="e.g. Cham"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
            />
            <div className="hint">Up to 10 characters, letters and numbers only. Case-sensitive.</div>
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

          {connected && (
            <div className="burn-info">
              {balance === null ? (
                'Loading your balance...'
              ) : (
                <>
                  Changing the token costs <strong>{burnTokensFmt}</strong> tokens
                  (0.1% of the supply). Your balance: <strong>{fmt(balance)}</strong>
                  {insufficient && (
                    <>
                      {' '}
                      — <strong style={{ color: 'var(--red)' }}>not enough to burn</strong>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          <div className="action-row">
            <WalletMultiButton />
            {connected ? (
              <button
                className="btn"
                onClick={submit}
                disabled={busy || balance === null || insufficient || burnAmount === 0n}
              >
                {busy
                  ? 'Processing...'
                  : `Burn ${burnTokensFmt} tokens and change the token`}
              </button>
            ) : (
              <span className="hint">
                Connect your wallet to burn {burnTokensFmt} tokens (0.1% of the
                supply) and submit the change.
              </span>
            )}
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
          {status.kind === 'ok' && status.shareText && (
            <a
              className="share-x"
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `${status.shareText} ${window.location.origin}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Share on X
            </a>
          )}
        </div>
      )}
    </div>
  );
}
