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
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
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

interface Quote {
  payUsd: number;
  solPriceUsd: number;
  solToPay: number;
  payToWallet: string;
}

export default function ChangeForm({ state, onChanged }: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [cooldown, setCooldown] = useState(0);

  const mint = state?.mint || '';
  const payUsd = state?.payUsd ?? 50;

  // Live quote: how much SOL equals payUsd right now
  const [quote, setQuote] = useState<Quote | null>(null);
  const loadQuote = useCallback(async (): Promise<Quote | null> => {
    try {
      const res = await fetch('/api/quote', { cache: 'no-store' });
      if (!res.ok) return null;
      const q = (await res.json()) as Quote;
      setQuote(q);
      return q;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    loadQuote();
    const id = setInterval(loadQuote, 45000);
    return () => clearInterval(id);
  }, [loadQuote]);

  // Local cooldown countdown, synced with the server
  useEffect(() => {
    setCooldown(state?.cooldownRemaining ?? 0);
  }, [state?.cooldownRemaining]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the wallet's SOL balance
  const loadBalance = useCallback(async () => {
    if (!publicKey) {
      setSolBalance(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(publicKey);
      setSolBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      setSolBalance(0);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  // SOL to pay for the displayed quote, +2% buffer against price drift +
  // a little for the network fee
  const solToPay = useCallback((q: Quote | null) => {
    if (q === null) return 0;
    return q.solToPay * 1.02;
  }, []);

  const displaySol = useMemo(() => solToPay(quote), [quote, solToPay]);
  // Needs the payment + a small fee cushion
  const insufficient =
    solBalance !== null && displaySol > 0 && solBalance < displaySol + 0.002;

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setImageFile(f);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!publicKey || !mint) return;
    const cleanName = name.trim();
    const cleanSymbol = symbol.trim();
    // Validate BEFORE paying so nobody wastes a payment on invalid input
    if (!/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/.test(cleanName) || cleanName.length > 15) {
      setStatus({ kind: 'err', msg: 'Invalid name: up to 15 characters, letters and numbers only.' });
      return;
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(cleanSymbol)) {
      setStatus({ kind: 'err', msg: 'Invalid ticker: up to 10 characters, letters and numbers only.' });
      return;
    }
    if (imageFile) {
      if (!['image/png', 'image/jpeg', 'image/gif'].includes(imageFile.type)) {
        setStatus({ kind: 'err', msg: 'Image must be PNG, JPEG or GIF.' });
        return;
      }
      if (imageFile.size > 2 * 1024 * 1024) {
        setStatus({
          kind: 'err',
          msg: `Image too large: ${(imageFile.size / 1024 / 1024).toFixed(1)} MB (2 MB max). Compress it and try again — nothing was paid.`,
        });
        return;
      }
    }

    setBusy(true);
    try {
      // 1) Fresh quote AT PAYMENT TIME, then pay that much SOL (+buffer)
      setStatus({ kind: 'info', msg: 'Quoting the payment at the current SOL price...' });
      const freshQuote = (await loadQuote()) ?? quote;
      if (!freshQuote) {
        setStatus({ kind: 'err', msg: 'Price feed unavailable — nothing was paid. Try again shortly.' });
        return;
      }
      const paySol = solToPay(freshQuote);
      const lamports = Math.ceil(paySol * LAMPORTS_PER_SOL);
      if (solBalance === null || solBalance < paySol + 0.002) {
        setStatus({
          kind: 'err',
          msg: `Insufficient SOL: changing the token costs ≈${paySol.toFixed(4)} SOL (~$${payUsd}) right now, plus network fee. Nothing was paid.`,
        });
        return;
      }

      setStatus({
        kind: 'info',
        msg: `Approve the payment of ≈${paySol.toFixed(4)} SOL (~$${payUsd}) in your wallet...`,
      });
      const ix = SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(freshQuote.payToWallet),
        lamports,
      });
      const tx = new Transaction().add(ix);
      const latest = await connection.getLatestBlockhash();
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);

      setStatus({ kind: 'info', msg: 'Payment sent. Waiting for on-chain confirmation...' });
      await connection.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        'confirmed',
      );

      // 2) Submit the form with proof of payment. If another change won the
      // slot (cooldown/lock), retry automatically — the payment signature
      // stays valid for ~15 minutes, so it is never wasted.
      setStatus({ kind: 'info', msg: 'Payment confirmed! Updating the token metadata...' });
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
            shareText: `I just changed the chameleon's skin: it's now ${data.name} ($${data.symbol}) 🦎`,
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
        // flight). Keep retrying up to ~13 min of total payment-tx validity.
        if (res.status === 429 && typeof data.retryAfter === 'number' && attempt < 15) {
          attempt++;
          const wait = Math.min(Math.max(data.retryAfter, 2), 150);
          setStatus({
            kind: 'info',
            msg: `${data.error} Your payment is safe — submitting again automatically in ${wait}s. Keep this page open.`,
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
              {solBalance === null ? (
                'Loading your SOL balance...'
              ) : quote === null ? (
                'Quoting the payment at the current SOL price...'
              ) : (
                <>
                  Changing the token costs <strong>${payUsd}</strong> in SOL — right
                  now ≈ <strong>{displaySol.toFixed(4)} SOL</strong>, quoted again at
                  payment time. Your balance:{' '}
                  <strong>{solBalance.toFixed(4)} SOL</strong>
                  {insufficient && (
                    <>
                      {' '}
                      — <strong style={{ color: 'var(--red)' }}>not enough SOL</strong>
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
                disabled={busy || solBalance === null || insufficient || quote === null}
              >
                {busy ? 'Processing...' : `Pay $${payUsd} in SOL and change the token`}
              </button>
            ) : (
              <span className="hint">
                Connect your wallet to pay ${payUsd} in SOL and submit the change.
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
