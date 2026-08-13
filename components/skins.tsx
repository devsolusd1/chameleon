'use client';

import { useEffect } from 'react';
import Image from 'next/image';

export interface SkinRecord {
  name: string;
  symbol: string;
  wallet: string;
  signature: string;
  updateSignature?: string;
  imageUrl?: string | null;
  ts: number;
}

export function shortAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDuration(total: number) {
  const s = Math.max(0, total);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function PerfBadge({ perf }: { perf: number | null | undefined }) {
  if (perf === null || perf === undefined) return null;
  const up = perf >= 0;
  return (
    <span
      className={`perf ${up ? 'up' : 'down'}`}
      title="Token price change while this skin was active (from the moment it took over until it was replaced — or until now, for the current skin)"
    >
      {up ? '+' : '−'}
      {Math.abs(perf).toFixed(1)}%
    </span>
  );
}

export function SkinCard({
  skin,
  current,
  perf,
  onClick,
}: {
  skin: SkinRecord;
  current: boolean;
  perf: number | null | undefined;
  onClick: () => void;
}) {
  return (
    <div
      className={`skin-card${current ? ' current' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      {current && <div className="skin-badge">CURRENT SKIN</div>}
      <Image
        className="skin-img"
        src={skin.imageUrl || '/logo.png'}
        alt={`${skin.name} token image`}
        width={96}
        height={96}
        loading="lazy"
      />
      <div className="skin-name">{skin.name}</div>
      <div className="skin-ticker">
        ${skin.symbol} <PerfBadge perf={perf} />
      </div>
      <div className="skin-meta">
        {timeAgo(skin.ts)} · by{' '}
        <a
          href={`https://solscan.io/account/${skin.wallet}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {shortAddr(skin.wallet)}
        </a>
      </div>
    </div>
  );
}

export function SkinModal({
  skin,
  perf,
  endTs,
  onClose,
}: {
  skin: SkinRecord;
  perf: number | null | undefined;
  endTs: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <Image
          className="modal-img"
          src={skin.imageUrl || '/logo.png'}
          alt={`${skin.name} token image`}
          width={260}
          height={260}
        />
        <h3 className="modal-name">{skin.name}</h3>
        <div className="skin-ticker">
          ${skin.symbol} <PerfBadge perf={perf} />
        </div>
        <div className="modal-rows">
          <div>
            <span>Worn for</span>
            <strong>{fmtDuration(endTs - skin.ts)}</strong>
          </div>
          <div>
            <span>Since</span>
            <strong>{new Date(skin.ts * 1000).toLocaleString('en-US')}</strong>
          </div>
          <div>
            <span>Changed by</span>
            <a
              href={`https://solscan.io/account/${skin.wallet}`}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(skin.wallet)}
            </a>
          </div>
          <div>
            <span>Transactions</span>
            <span>
              <a
                href={`https://solscan.io/tx/${skin.signature}`}
                target="_blank"
                rel="noreferrer"
              >
                burn
              </a>
              {skin.updateSignature && (
                <>
                  {' · '}
                  <a
                    href={`https://solscan.io/tx/${skin.updateSignature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    update
                  </a>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
