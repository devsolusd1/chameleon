'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ChangeForm from '@/components/ChangeForm';
import {
  fmtDuration,
  PerfBadge,
  shortAddr,
  SkinCard,
  SkinModal,
  type SkinRecord,
} from '@/components/skins';

export interface SiteState {
  name: string;
  symbol: string;
  description: string;
  mint: string;
  burnAmount: number;
  cooldownSeconds: number;
  cooldownRemaining: number;
  history: SkinRecord[];
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

export default function Home() {
  const [state, setState] = useState<SiteState | null>(null);
  const [burnedStats, setBurnedStats] = useState<BurnedStats | null>(null);
  const [skinPerfs, setSkinPerfs] = useState<Record<string, number | null>>({});
  const [imageBust, setImageBust] = useState(0);
  const [copied, setCopied] = useState(false);
  const [newSkin, setNewSkin] = useState<{ name: string; symbol: string } | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<SkinRecord | null>(null);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const prevSigRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ticks the live "skin age" counter
  useEffect(() => {
    const id = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

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
      if (!res.ok) return;
      const data: SiteState = await res.json();
      setState(data);

      // Live skin-shed moment: the newest history entry changed while
      // this visitor had the page open
      const latest = data.history[0]?.signature ?? null;
      if (prevSigRef.current !== null && latest && latest !== prevSigRef.current) {
        setImageBust((n) => n + 1);
        setNewSkin({ name: data.name, symbol: data.symbol });
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setNewSkin(null), 6000);
      }
      prevSigRef.current = latest;
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

  useEffect(() => {
    const loadPerfs = async () => {
      try {
        const res = await fetch('/api/skins', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setSkinPerfs(data.perfs ?? {});
        }
      } catch {
        // keep the previous values; retry on next tick
      }
    };
    loadPerfs();
    const id = setInterval(loadPerfs, 60000);
    return () => clearInterval(id);
  }, []);

  const burnFmt = (state?.burnAmount ?? 1000000).toLocaleString('en-US');
  const cooldownMin = Math.round((state?.cooldownSeconds ?? 120) / 60);

  // End of each skin's reign: the next change, or now for the current one
  const skinEndTs = useCallback(
    (skin: SkinRecord) => {
      if (!state) return nowTs;
      const i = state.history.findIndex((h) => h.signature === skin.signature);
      return i <= 0 ? nowTs : state.history[i - 1].ts;
    },
    [state, nowTs],
  );

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <div className="logo">
            <Image src="/logo.png" alt="Chameleon logo" width={38} height={38} />
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
            <img
              className={`token-image${newSkin ? ' shed' : ''}`}
              src={`/api/image?v=${imageBust}`}
              alt="Current token image"
            />
            <h1>{state?.name ?? 'Chameleon'}</h1>
            <div className="ticker">${state?.symbol ?? 'CHMLN'}</div>
            {state && state.history.length > 0 && (
              <div className="skin-age">
                this skin has been alive for{' '}
                <strong>{fmtDuration(nowTs - state.history[0].ts)}</strong>
                <PerfBadge perf={skinPerfs[state.history[0].signature]} />
              </div>
            )}
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
              <p className="mint-line">
                {state === null ? '' : 'Token not launched yet — coming soon.'}
              </p>
            )}
          </div>
        </section>

        {burnedStats === null ? (
          <section className="stats-band">
            <div className="container stats-row">
              <div className="skeleton skeleton-stat" />
              <div className="skeleton skeleton-stat" />
              <div className="skeleton skeleton-stat" />
            </div>
          </section>
        ) : (
          burnedStats.burned > 0 && (
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
          )
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
            <ChangeForm state={state} onChanged={refresh} />
            <p className="section-note">
              Changes are instant on-chain, but trading terminals and wallets
              (Axiom, GMGN, Dexscreener, Phantom, etc.) cache token metadata and
              may take several minutes — sometimes longer — to show the new
              name, ticker and image.
            </p>
          </div>
        </section>

        {state === null ? (
          <section className="section">
            <div className="container">
              <h2>Hall of Skins</h2>
              <div className="skins-grid">
                {Array.from({ length: 5 }, (_, i) => (
                  <div className="skeleton skeleton-card" key={i} />
                ))}
              </div>
            </div>
          </section>
        ) : (
          state.history.length > 0 && (
            <section className="section">
              <div className="container">
                <h2>Hall of Skins</h2>
                <p className="section-intro">
                  Every identity this coin has ever worn — each one paid for with a
                  burn. The percentage next to each ticker is how much the token&apos;s
                  price moved while that skin was active: from the moment it took
                  over until it was replaced (the current skin counts up to right
                  now). Green skins pumped, red skins dumped.
                </p>
                <div className="skins-grid">
                  {/* API already returns newest first */}
                  {state.history.map((h, i) => (
                    <SkinCard
                      key={h.signature}
                      skin={h}
                      current={i === 0}
                      perf={skinPerfs[h.signature]}
                      onClick={() => setSelectedSkin(h)}
                    />
                  ))}
                </div>
                <p className="archive-link">
                  <Link href="/skins">View the full skin archive →</Link>
                </p>
              </div>
            </section>
          )
        )}

        {state && state.history.length > 0 && (
          <section className="section">
            <div className="container">
              <h2>Latest changes</h2>
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
            </div>
          </section>
        )}
      </main>

      {selectedSkin && (
        <SkinModal
          skin={selectedSkin}
          perf={skinPerfs[selectedSkin.signature]}
          endTs={skinEndTs(selectedSkin)}
          onClose={() => setSelectedSkin(null)}
        />
      )}

      {newSkin && (
        <div className="toast">
          New skin — {newSkin.name} (${newSkin.symbol})
        </div>
      )}

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
