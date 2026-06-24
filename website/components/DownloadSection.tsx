'use client';

import { useEffect, useState } from 'react';
import { MotionButton } from './MotionButton';
import { Reveal } from './Reveal';

type LatestRelease = {
  version: string;
  notes: string;
  pubDate: string;
  assets: { setup: string; portable: string };
};

export function DownloadSection() {
  const [release, setRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    fetch('/api/latest')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && !d.error && setRelease(d))
      .catch(() => {});
  }, []);

  const releasedOn = release
    ? new Date(release.pubDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <section id="download" className="section download">
      <div className="container">
        <Reveal>
          <div className="download-inner">
            <p className="eyebrow">Download</p>
            <h2 className="download-head">Download Flowstate</h2>
            <p className="download-sub">Windows · Free to start</p>

            <div className="download-btns">
              <MotionButton
                href="/api/download/setup"
                className="btn-primary download-btn"
              >
                Download Setup (.exe)
              </MotionButton>
              <MotionButton
                href="/api/download/portable"
                className="btn-ghost download-btn"
              >
                Download Portable (.zip)
              </MotionButton>
            </div>

            {release && (
              <p className="download-version mono">
                v{release.version}
                {releasedOn ? ` · Released ${releasedOn}` : ''}
              </p>
            )}
          </div>
        </Reveal>
      </div>

      <style jsx global>{`
        .download {
          text-align: center;
        }
        .download-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--s-4);
          padding: clamp(40px, 7vw, 80px) clamp(24px, 5vw, 64px);
          background: linear-gradient(180deg, var(--surface-2), var(--surface));
          border: 1px solid var(--border-strong);
          border-radius: var(--r-2xl);
          box-shadow: var(--shadow-lg);
        }
        .download-head {
          font-size: clamp(32px, 5vw, 56px);
        }
        .download-sub {
          color: var(--ink-muted);
          font-size: 16px;
        }
        .download-btns {
          display: flex;
          flex-wrap: wrap;
          gap: var(--s-3);
          justify-content: center;
          margin-top: var(--s-4);
        }
        .download-version {
          margin-top: var(--s-3);
          font-size: 12px;
          letter-spacing: 0.06em;
          color: var(--ink-faint);
        }
      `}</style>
    </section>
  );
}
