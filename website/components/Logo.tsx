/** Flowstate wordmark + mark. Pure monochrome, token-driven. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        color: 'var(--ink-strong)',
        fontSize: size,
        lineHeight: 1,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {/* Three drifting strata — a calm "flow state". */}
        <path
          d="M4 7.5C8 5 12 5 16 7.5C18 9 19.5 9 21 8"
          stroke="var(--accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.95"
        />
        <path
          d="M3 12C7 9.5 12 9.5 16 12C18 13.5 19.5 13.5 21 12.5"
          stroke="var(--accent-warm)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M4 16.5C8 14 12 14 16 16.5C18 18 19 18 20 17.5"
          stroke="var(--ink-faint)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
      Flowstate
    </span>
  );
}
