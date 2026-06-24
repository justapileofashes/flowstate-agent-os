interface Props {
  onCreate: () => void;
}

export function EmptyChatState({ onCreate }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center px-8">
      <div className="eyebrow">Fresh start</div>
      <h2
        style={{
          fontWeight: 300,
          fontSize: 28,
          letterSpacing: '-0.015em',
          color: 'var(--ink-strong)',
          margin: 0,
        }}
      >
        Ready when you are.
      </h2>
      <p className="text-[var(--ink-muted)] text-sm max-w-md">
        Start a new session with this agent, or pick a past session from the left rail.
        Drag files into the composer to attach them; paste an image to send a screenshot.
      </p>
      <button type="button" className="btn btn-primary" onClick={onCreate}>
        Start a new session
      </button>
    </div>
  );
}
