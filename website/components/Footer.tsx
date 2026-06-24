'use client';

import Link from 'next/link';
import { Logo } from './Logo';
import { useAnchorScroll } from './useAnchorScroll';

const LINKS = [
  { label: 'Features', hash: '#features' },
  { label: 'Download', hash: '#download' },
  { label: 'Contact', hash: '#contact' },
];

export function Footer() {
  const onAnchor = useAnchorScroll();
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <Link href="/#hero" aria-label="Flowstate home">
            <Logo size={18} />
          </Link>
          <span className="footer-copy">© {year} Flowstate</span>
        </div>

        <nav className="footer-links" aria-label="Footer">
          {LINKS.map((l) => (
            <a
              key={l.hash}
              href={`/${l.hash}`}
              onClick={onAnchor(l.hash)}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <p className="footer-tier">
          Free to start. Pro and Max plans available.
        </p>
      </div>

      <p className="footer-micro container">
        Built for local inference. Your data stays on your machine.
      </p>

      <style jsx global>{`
        .footer {
          border-top: 1px solid var(--border);
          padding-block: var(--s-10) var(--s-8);
          margin-top: var(--s-8);
        }
        .footer-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--s-6);
          flex-wrap: wrap;
        }
        .footer-brand {
          display: flex;
          align-items: center;
          gap: var(--s-4);
        }
        .footer-copy {
          font-size: 13px;
          color: var(--ink-faint);
        }
        .footer-links {
          display: flex;
          gap: var(--s-6);
        }
        .footer-links a {
          font-size: 14px;
          color: var(--ink-muted);
          transition: color var(--d-base) var(--ease);
        }
        .footer-links a:hover {
          color: var(--ink-strong);
        }
        .footer-tier {
          font-size: 13px;
          color: var(--ink-faint);
          max-width: 22ch;
          text-align: right;
        }
        .footer-micro {
          margin-top: var(--s-8);
          font-size: 12px;
          color: var(--ink-quiet);
        }
        @media (max-width: 768px) {
          .footer-inner {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--s-5);
          }
          .footer-tier {
            text-align: left;
          }
        }
      `}</style>
    </footer>
  );
}
