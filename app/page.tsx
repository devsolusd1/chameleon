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
    imageUrl?: string | null;
    ts: number;
  }[];
}

function shortAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export interface BurnedStats {
  initialSupply: number;
  currentSupply: number;
  burned: number;
  burnedPercent: number;
  priceUsd: number | null;
  burnedValueUsd: number | null;
}

function fmtTokens(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Home() {
  const [state, setState] = useState<SiteState | null>(null);
  const [burnedStats, setBurnedStats] = useState<BurnedStats | null>(null);
  const [imageBust, setImageBust] = useState(0);
  const [copied, setCopied] = useState(false);

  const copyCA = useCallback(async () => {
    if (!state?.mint) return;
    try {
      await navigator.clipboard.writeText(state.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; the mint link below still shows the address
    }
  }, [state?.mint]);

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

  useEffect(() => {
    const loadBurned = async () => {
      try {
        const res = await fetch('/api/burned', { cache: 'no-store' });
        if (res.ok) setBurnedStats(await res.json());
      } catch {
        // keep the previous stats; retry on next tick
      }
    };
    loadBurned();
    const id = setInterval(loadBurned, 60000);
    return () => clearInterval(id);
  }, []);

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
              <>
                <div className="hero-actions">
                  <button className="btn-small" onClick={copyCA}>
                    {copied ? 'Copied' : 'Copy CA'}
                  </button>
                  <a
                    className="btn-small"
                    href={`https://jup.ag/swap/SOL-${state.mint}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buy
                  </a>
                  <a
                    className="btn-small"
                    href={`https://dexscreener.com/solana/${state.mint}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Chart
                  </a>
                </div>
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
              </>
            ) : (
              <p className="mint-line">Token not launched yet — coming soon.</p>
            )}
          </div>
        </section>

        {burnedStats && burnedStats.burned > 0 && (
          <section className="stats-band">
            <div className="container stats-row">
              <div className="stat">
                <div className="stat-label">Burned so far</div>
                <div className="stat-value">{fmtTokens(burnedStats.burned)}</div>
                <div className="stat-sub">
                  {burnedStats.burnedPercent.toFixed(3)}% of the supply — destroyed
                  forever, one change at a time
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Estimated value</div>
                <div className="stat-value">
                  {burnedStats.burnedValueUsd !== null ? fmtUsd(burnedStats.burnedValueUsd) : '—'}
                </div>
                <div className="stat-sub">
                  {burnedStats.priceUsd !== null
                    ? `at current price ($${burnedStats.priceUsd.toLocaleString('en-US', { maximumSignificantDigits: 4 })})`
                    : 'price unavailable'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Circulating supply</div>
                <div className="stat-value">{fmtTokens(burnedStats.currentSupply)}</div>
                <div className="stat-sub">
                  out of {fmtTokens(burnedStats.initialSupply)} minted
                </div>
              </div>
            </div>
          </section>
        )}

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
              Changes are instant on-chain, but trading terminals and wallets
              (Axiom, GMGN, Dexscreener, Phantom, etc.) cache token metadata and
              may take several minutes — sometimes longer — to show the new
              name, ticker and image.
            </p>
          </div>
        </section>

        {state && state.history.length > 0 && (
          <section className="section">
            <div className="container">
              <h2>Hall of Skins</h2>
              <p className="section-intro">
                Every identity this coin has ever worn — each one paid for with a burn.
              </p>
              <div className="skins-grid">
                {/* API already returns newest first */}
                {state.history.map((h, i) => (
                  <div className={`skin-card${i === 0 ? ' current' : ''}`} key={h.signature}>
                    {i === 0 && <div className="skin-badge">CURRENT SKIN</div>}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="skin-img"
                      src={h.imageUrl || '/logo.png'}
                      alt={`${h.name} token image`}
                      loading="lazy"
                    />
                    <div className="skin-name">{h.name}</div>
                    <div className="skin-ticker">${h.symbol}</div>
                    <div className="skin-meta">
                      {timeAgo(h.ts)} · by{' '}
                      <a
                        href={`https://solscan.io/account/${h.wallet}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(h.wallet)}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

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
                          burn
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
                              update
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
