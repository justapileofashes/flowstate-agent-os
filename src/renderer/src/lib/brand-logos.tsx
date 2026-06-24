// Brand logos — Simple Icons paths + official brand hex colors for branded
// services; custom stroked SVGs for generic/concept icons that have no brand.
// Icons whose brand color is very dark (GitHub, Notion, Anthropic, xAI) use
// white so they remain visible on Flowstate's dark surfaces.

import type { JSX } from 'react';
import {
  siGit,
  siGithub,
  siGoogledrive,
  siBrave,
  siGmail,
  siTelegram,
  siDiscord,
  siWhatsapp,
  siInstagram,
  siNotion,
  siLinear,
  siGoogleclassroom,
  siBlender,
  siGooglecalendar,
  siFigma,
  siVercel,
  siSupabase,
  siN8n,
  siStripe,
  siAnthropic,
  siGooglegemini,
  siPerplexity,
  siMistralai,
} from 'simple-icons';

interface Props {
  name: string;
  size?: number;
}

/** Render a simple-icons icon. Pass hexOverride for dark-on-dark brand colors. */
function si(
  icon: { path: string; hex: string },
  size: number,
  hexOverride?: string,
): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={`#${hexOverride ?? icon.hex}`}>
      <path d={icon.path} />
    </svg>
  );
}

const GLYPHS: Record<string, (size: number) => JSX.Element> = {
  // ── Generic / no brand ────────────────────────────────────────────────────
  Filesystem: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  ),
  'Web fetch': (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  ),
  Memory: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M7 6v12M11 6v12M15 6v12M19 6v12M3 10h18M3 14h18" />
    </svg>
  ),
  SQLite: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v14a8 2.5 0 0 0 16 0V5" />
      <path d="M4 12a8 2.5 0 0 0 16 0" />
    </svg>
  ),
  'Browser (Puppeteer)': (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18M7 6h.01M10 6h.01M13 6h.01" />
    </svg>
  ),
  Time: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),

  // ── Dev / Files ────────────────────────────────────────────────────────────
  Git: (s) => si(siGit, s),                              // #F03C2E
  GitHub: (s) => si(siGithub, s, 'FFFFFF'),             // brand #181717 → white on dark
  'Google Drive': (s) => (
    // Official Google Drive tri-colour logo
    <svg width={s} height={s} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M7.71 3.5L2 13.12l3.63 6.25 5.71-9.87z" />
      <path fill="#34A853" d="M16.29 3.5H7.71l5.71 9.87H22z" />
      <path fill="#FBBC04" d="M2 13.12l3.63 6.26h12.74l3.63-6.26z" />
    </svg>
  ),

  // ── Web ───────────────────────────────────────────────────────────────────
  'Brave Search': (s) => si(siBrave, s),                 // #FB542B

  // ── Memory / DB ───────────────────────────────────────────────────────────
  // (Memory and SQLite are generic — handled above)

  // ── Messaging ─────────────────────────────────────────────────────────────
  Telegram: (s) => si(siTelegram, s),                    // #26A5E4
  Discord: (s) => si(siDiscord, s),                      // #5865F2
  Slack: (s) => (
    // Slack 4-colour hashtag mark
    <svg width={s} height={s} viewBox="0 0 24 24">
      {/* left arm + left circle — pink */}
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
      {/* top arm + top circle — teal */}
      <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
      {/* right arm + right circle — green */}
      <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.271 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.162 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" />
      {/* bottom arm + bottom circle — yellow */}
      <path fill="#ECB22E" d="M15.162 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.162 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.271a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.162a2.528 2.528 0 0 1-2.525 2.523h-6.313z" />
    </svg>
  ),
  Gmail: (s) => si(siGmail, s),                          // #EA4335
  WhatsApp: (s) => si(siWhatsapp, s),                    // #25D366
  Instagram: (s) => (
    // Instagram gradient camera
    <svg width={s} height={s} viewBox="0 0 24 24">
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <path fill="url(#ig-grad)" d={siInstagram.path} />
    </svg>
  ),

  // ── Productivity ──────────────────────────────────────────────────────────
  Notion: (s) => si(siNotion, s, 'FFFFFF'),             // brand #000000 → white on dark
  Linear: (s) => si(siLinear, s),                        // #5E6AD2

  // ── Education ─────────────────────────────────────────────────────────────
  'Google Classroom': (s) => si(siGoogleclassroom, s),  // #0F9D58

  // ── 3D / Creative ────────────────────────────────────────────────────────
  Blender: (s) => si(siBlender, s),                      // #E87D0D
  Figma: (s) => si(siFigma, s),                          // #F24E1E
  Canva: (s) => (
    // No official Simple Icon — gradient disc + white "C" arc.
    <svg width={s} height={s} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="canva-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00C4CC" />
          <stop offset="100%" stopColor="#7D2AE8" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#canva-grad)" />
      <path d="M15.6 9a4 4 0 1 0 0 6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  Gamma: (s) => (
    // No official Simple Icon — gradient tile + white spark.
    <svg width={s} height={s} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="gamma-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#gamma-grad)" />
      <path d="M12 6.5l1.7 3.8L17.5 12l-3.8 1.7L12 17.5l-1.7-3.8L6.5 12l3.8-1.7z" fill="#fff" />
    </svg>
  ),

  // ── Productivity (Calendar) ───────────────────────────────────────────────
  'Google Calendar': (s) => si(siGooglecalendar, s),     // #4285F4

  // ── Dev / Cloud ───────────────────────────────────────────────────────────
  Vercel: (s) => si(siVercel, s, 'FFFFFF'),             // brand #000000 → white on dark
  Supabase: (s) => si(siSupabase, s),                    // #3FCF8E
  n8n: (s) => si(siN8n, s),                              // #EA4B71
  Stripe: (s) => si(siStripe, s),                        // #635BFF

  // ── Research / Web ────────────────────────────────────────────────────────
  Firecrawl: (s) => (
    // No official Simple Icon — orange flame.
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#FF5500">
      <path d="M13 2c1 3-1 5-2.5 6.5C9 10 8 11.5 8 13a4 4 0 0 0 8 .3c0-1-.4-2-.4-2 .9.6 1.4 1.7 1.4 3a5 5 0 1 1-9.9-.9C5.6 13 8 11 9 8.7 9.8 6.8 9.6 4.2 13 2z" />
    </svg>
  ),
  graphify: (s) => (
    // Local skill — generic knowledge-graph mark.
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="17" r="2.2" />
      <path d="M7.8 8.3l3 7M16.6 7.7l-3.4 7.6M8 7h7.8" />
    </svg>
  ),

  // ── Cloud providers ───────────────────────────────────────────────────────
  Anthropic: (s) => si(siAnthropic, s, 'D97757'),       // brand #191919 → warm orange
  OpenAI: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#10a37f">
      <path d="M22.28 9.82a6 6 0 0 0-.52-4.91 6.06 6.06 0 0 0-6.52-2.9A6 6 0 0 0 4.98 4.18 6 6 0 0 0 .99 7.1a6.06 6.06 0 0 0 .74 7.1 6 6 0 0 0 .52 4.91 6.07 6.07 0 0 0 6.53 2.9 6 6 0 0 0 10.26-2.17 6 6 0 0 0 3.99-2.91 6.06 6.06 0 0 0-.74-7.1zm-9.06 12.66a4.5 4.5 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49zm-9.66-4.13a4.5 4.5 0 0 1-.53-3.03l.14.08 4.78 2.76a.78.78 0 0 0 .79 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07l-4.83 2.79a4.5 4.5 0 0 1-6.16-1.63zM2.3 8.32a4.5 4.5 0 0 1 2.34-1.98v5.68a.78.78 0 0 0 .39.67l5.81 3.36-2.02 1.17a.07.07 0 0 1-.07 0L3.92 14.43A4.5 4.5 0 0 1 2.3 8.32zm16.6 3.86l-5.84-3.4 2.02-1.17a.07.07 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.1v-5.65a.78.78 0 0 0-.4-.67zm2.02-3.04l-.14-.08-4.78-2.77a.78.78 0 0 0-.79 0L9.36 9.66V7.33a.08.08 0 0 1 .03-.07l4.83-2.78a4.5 4.5 0 0 1 6.7 4.66zm-12.65 4.2l-2.02-1.17a.08.08 0 0 1-.04-.06V6.53a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.78.78 0 0 0-.4.68zm1.1-2.36L11.97 9.46l2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
    </svg>
  ),
  'Google Gemini': (s) => si(siGooglegemini, s),         // #8E75B2
  Gemini: (s) => si(siGooglegemini, s),
  Perplexity: (s) => si(siPerplexity, s),                // #1FB8CD
  xAI: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#FFFFFF">
      <path d="M2 3h4l16 18h-4L2 3zm0 18L12 9.5l2.5 3L8 21H2zm14-18h4l-6 6.5-2.5-3L16 3z" />
    </svg>
  ),
  Mistral: (s) => si(siMistralai, s),                    // #FA520F
  Groq: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#F55036">
      <path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z" />
    </svg>
  ),
  Cohere: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#39594D">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="#0d1f1a" />
    </svg>
  ),
  Together: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="7" cy="12" r="3" fill="#6366f1" />
      <circle cx="17" cy="12" r="3" fill="#8b5cf6" />
      <path d="M7 12h10" stroke="#a78bfa" strokeWidth={2} />
    </svg>
  ),
  Fireworks: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth={1.6} strokeLinecap="round">
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4" />
    </svg>
  ),
};

const ALIASES: Record<string, string> = {
  Anthropic: 'Anthropic',
  'Anthropic (Claude)': 'Anthropic',
  OpenAI: 'OpenAI',
  'OpenAI (GPT)': 'OpenAI',
  Google: 'Google Gemini',
  'Google (Gemini)': 'Google Gemini',
  Gemini: 'Google Gemini',
  Perplexity: 'Perplexity',
  'Perplexity (Sonar)': 'Perplexity',
  xAI: 'xAI',
  'xAI (Grok)': 'xAI',
  Mistral: 'Mistral',
  Groq: 'Groq',
  'Groq (fast Llama / Qwen)': 'Groq',
};

export function BrandLogo({ name, size = 18 }: Props): JSX.Element {
  const key = ALIASES[name] ?? name;
  const draw = GLYPHS[key];
  if (draw) return draw(size);
  // Fallback: 2-letter monogram from name.
  const initials = name
    .split(/[\s—-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="10"
        fill="currentColor"
      >
        {initials || '?'}
      </text>
    </svg>
  );
}
