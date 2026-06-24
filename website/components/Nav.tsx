'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Logo } from './Logo';
import { useAnchorScroll } from './useAnchorScroll';

const LINKS = [
  { label: 'Features', hash: '#features' },
  { label: 'Download', hash: '#download' },
];

export function Nav() {
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const onAnchor = useAnchorScroll();

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const handleAnchor = (hash: string) => (e: React.MouseEvent) => {
    setMenuOpen(false);
    onAnchor(hash)(e);
  };

  return (
    <>
      <nav className="nav" data-condensed={condensed || undefined}>
        <div className="nav-inner container">
          <Link href="/#hero" aria-label="Flowstate home" className="nav-logo">
            <Logo size={condensed ? 18 : 20} />
          </Link>

          <div className="nav-links">
            {LINKS.map((l) => (
              <a
                key={l.hash}
                href={`/${l.hash}`}
                onClick={handleAnchor(l.hash)}
                className="nav-link"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="nav-cta">
            <a
              href="/#download"
              onClick={handleAnchor('#download')}
              className="btn btn-primary nav-cta-btn"
            >
              Download
            </a>
          </div>

          <button
            className="nav-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span data-open={menuOpen || undefined} />
            <span data-open={menuOpen || undefined} />
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="nav-drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="nav-drawer-links">
              {LINKS.map((l, i) => (
                <motion.a
                  key={l.hash}
                  href={`/${l.hash}`}
                  onClick={handleAnchor(l.hash)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.05 + i * 0.05,
                    duration: 0.32,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  {l.label}
                </motion.a>
              ))}
              <motion.a
                href="/#download"
                onClick={handleAnchor('#download')}
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.32 }}
              >
                Download Flowstate
              </motion.a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 50;
          transition: background-color var(--d-base) var(--ease),
            backdrop-filter var(--d-base) var(--ease),
            border-color var(--d-base) var(--ease);
          border-bottom: 1px solid transparent;
        }
        .nav[data-condensed] {
          background: rgba(14, 13, 12, 0.72);
          backdrop-filter: blur(16px) saturate(1.2);
          -webkit-backdrop-filter: blur(16px) saturate(1.2);
          border-bottom-color: var(--border);
        }
        .nav-inner {
          display: flex;
          align-items: center;
          gap: var(--s-6);
          height: 64px;
          transition: height var(--d-base) var(--ease);
        }
        .nav[data-condensed] .nav-inner {
          height: 48px;
        }
        .nav-logo {
          display: inline-flex;
          align-items: center;
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: var(--s-6);
          margin-left: auto;
        }
        .nav-link {
          font-size: 14px;
          color: var(--ink-muted);
          transition: color var(--d-base) var(--ease);
          position: relative;
        }
        .nav-link:hover {
          color: var(--ink-strong);
        }
        .nav-cta {
          display: flex;
          align-items: center;
        }
        .nav-cta-btn {
          height: 38px;
          padding-inline: var(--s-5);
          font-size: 14px;
        }
        .nav-burger {
          display: none;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          width: 40px;
          height: 40px;
          margin-left: auto;
          background: transparent;
          border: none;
        }
        .nav-burger span {
          display: block;
          width: 20px;
          height: 1.5px;
          margin-inline: auto;
          background: var(--ink);
          transition: transform var(--d-base) var(--ease),
            opacity var(--d-base) var(--ease);
        }
        .nav-burger span[data-open]:first-child {
          transform: translateY(3.25px) rotate(45deg);
        }
        .nav-burger span[data-open]:last-child {
          transform: translateY(-3.25px) rotate(-45deg);
        }
        .nav-drawer {
          position: fixed;
          inset: 0;
          z-index: 49;
          background: rgba(8, 8, 10, 0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .nav-drawer-links {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--s-6);
          font-size: 24px;
        }
        .nav-drawer-links :global(a):not(.btn) {
          color: var(--ink-strong);
          font-weight: 500;
        }
        @media (max-width: 640px) {
          .nav-links,
          .nav-cta {
            display: none;
          }
          .nav-burger {
            display: flex;
          }
        }
      `}</style>
    </>
  );
}
