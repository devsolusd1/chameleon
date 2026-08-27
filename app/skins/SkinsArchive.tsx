'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SkinCard, SkinModal, type SkinRecord } from '@/components/skins';

interface HistoryPayload {
  name: string;
  symbol: string;
  mint: string;
  history: SkinRecord[];
}

export default function SkinsArchive() {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [skinPerfs, setSkinPerfs] = useState<Record<string, number | null>>({});
  const [selectedSkin, setSelectedSkin] = useState<SkinRecord | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/history', { cache: 'no-store' });
        if (res.ok) setData(await res.json());
      } catch {
        // leave the skeleton visible; the user can reload
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/skins', { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json();
          setSkinPerfs(d.perfs ?? {});
        }
      } catch {
        // badges are optional
      }
    })();
  }, []);

  const skinEndTs = (skin: SkinRecord) => {
    if (!data) return Math.floor(Date.now() / 1000);
    const i = data.history.findIndex((h) => h.signature === skin.signature);
    return i <= 0 ? Math.floor(Date.now() / 1000) : data.history[i - 1].ts;
  };

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <Link className="logo" href="/">
            <Image src="/logo.png" alt="Chameleon logo" width={38} height={38} />
            <span>{data ? `${data.name} ($${data.symbol})` : 'Chameleon'}</span>
          </Link>
          <Link className="btn-small" href="/">
            ← Back to the chameleon
          </Link>
        </div>
      </header>

      <main>
        <section className="section">
          <div className="container">
            <h2>Skin archive</h2>
            <p className="section-intro">
              Every identity this coin has ever worn — newest first, each one
              paid for on-chain. Click a skin for the
              full story.
            </p>
            {data === null ? (
              <div className="skins-grid">
                {Array.from({ length: 10 }, (_, i) => (
                  <div className="skeleton skeleton-card" key={i} />
                ))}
              </div>
            ) : data.history.length === 0 ? (
              <p className="section-intro">No skins yet — be the first to change one.</p>
            ) : (
              <div className="skins-grid">
                {data.history.map((h, i) => (
                  <SkinCard
                    key={h.signature}
                    skin={h}
                    current={i === 0}
                    perf={skinPerfs[h.signature]}
                    onClick={() => setSelectedSkin(h)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {selectedSkin && (
        <SkinModal
          skin={selectedSkin}
          perf={skinPerfs[selectedSkin.signature]}
          endTs={skinEndTs(selectedSkin)}
          onClose={() => setSelectedSkin(null)}
        />
      )}

      <footer className="footer">
        <div className="container">
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
