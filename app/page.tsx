'use client';

import { useCallback, useEffect, useState } from 'react';
import ChangeForm from '@/components/ChangeForm';

export interface SiteState {
  name: string;
  symbol: string;
  description: string;
  mint: string;
  burnAmount: number;
  cooldownSeconds: number;
  cooldownRemaining: number;
  history: {
    name: string;
    symbol: string;
    wallet: string;
    signature: string;
    updateSignature?: string;
    ts: number;
  }[];
}

function shortAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export default function Home() {
  const [state, setState] = useState<SiteState | null>(null);
  const [imageBust, setImageBust] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) setState(await res.json());
    } catch {
      // server unreachable; retry on next tick
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const onChanged = useCallback(() => {
    refresh();
    setImageBust((n) => n + 1);
  }, [refresh]);

  const burnFmt = (state?.burnAmount ?? 1000000).toLocaleString('en-US');
  const cooldownMin = Math.round((state?.cooldownSeconds ?? 120) / 60);

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <div className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Chameleon logo" />
            <span>
              {state?.name ?? 'Chameleon'}{' '}
              {state?.symbol ? `($${state.symbol})` : ''}
            </span>
          </div>
          <a
            className="x-link"
            href="https://x.com/chameleonsol"
            target="_blank"
            rel="noreferrer"
            aria-label="Follow us on X"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="token-image" src={`/api/image?v=${imageBust}`} alt="Current token image" />
            <h1>{state?.name ?? 'Chameleon'}</h1>
            <div className="ticker">${state?.symbol ?? 'CHMLN'}</div>
            <p className="tagline">
              The coin that changes its skin. Any holder can burn{' '}
              <strong>{burnFmt} tokens (0.1% of the supply)</strong> to change
              the token&apos;s name, ticker and image — straight on-chain. Only
              this website never changes.
            </p>
            {state?.mint ? (
              <p className="mint-line">
                Mint:{' '}
                <a
                  href={`https://solscan.io/token/${state.mint}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {state.mint}
                </a>
              </p>
            ) : (
              <p className="mint-line">Token not launched yet — coming soon.</p>
            )}
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>How it works</h2>
            <div className="cards">
              <div className="card">
                <div className="step">1</div>
                <h3>Connect your wallet</h3>
                <p>You need to hold at least {burnFmt} tokens in your wallet.</p>
              </div>
              <div className="card">
                <div className="step">2</div>
                <h3>Pick the new look</h3>
                <p>Fill in the new name, the new ticker and upload the new image.</p>
              </div>
              <div className="card">
                <div className="step">3</div>
                <h3>Burn 0.1% of the supply</h3>
                <p>
                  Approve the transaction that burns {burnFmt} tokens (0.1% of
                  the supply). The burn is verified on-chain.
                </p>
              </div>
              <div className="card">
                <div className="step">4</div>
                <h3>Instant change</h3>
                <p>
                  The metadata is updated right away. After that, a{' '}
                  {cooldownMin}-minute cooldown until the next change.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="change">
          <div className="container">
            <h2>Change the token</h2>
            <ChangeForm state={state} onChanged={onChanged} />
            <p className="section-note">
              ⏳ Changes are instant on-chain, but trading terminals and wallets
              (Axiom, GMGN, Dexscreener, Phantom, etc.) cache token metadata and
              may take several minutes — sometimes longer — to show the new
              name, ticker and image.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>Latest changes</h2>
            {state && state.history.length > 0 ? (
              <table className="history-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Name</th>
                    <th>Ticker</th>
                    <th>By</th>
                    <th>Txs</th>
                  </tr>
                </thead>
                <tbody>
                  {state.history.map((h) => (
                    <tr key={h.signature}>
                      <td>{new Date(h.ts * 1000).toLocaleString('en-US')}</td>
                      <td>{h.name}</td>
                      <td>${h.symbol}</td>
                      <td className="addr">
                        <a
                          href={`https://solscan.io/account/${h.wallet}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortAddr(h.wallet)}
                        </a>
                      </td>
                      <td className="txs">
                        <a
                          href={`https://solscan.io/tx/${h.signature}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Burn transaction"
                        >
                          🔥 burn
                        </a>
                        {h.updateSignature && (
                          <>
                            {' '}
                            <a
                              href={`https://solscan.io/tx/${h.updateSignature}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Metadata update transaction"
                            >
                              🦎 update
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: 'var(--text-soft)' }}>
                No changes yet. Be the first to change the chameleon&apos;s skin.
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <p>
            Burned tokens are destroyed permanently. This is not financial
            advice — join for the fun of it.
          </p>
          <p>
            <a href="https://x.com/chameleonsol" target="_blank" rel="noreferrer">
              Follow us on X — @chameleonsol
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}
