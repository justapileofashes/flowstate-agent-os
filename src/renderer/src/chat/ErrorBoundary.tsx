import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[flowstate] renderer crash', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center p-8">
          <div className="card max-w-xl space-y-3">
            <h2 className="text-lg font-semibold text-[var(--bad)]">Something broke</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              The UI crashed. Your data is safe; reload the window to recover.
            </p>
            <pre className="kbd text-xs whitespace-pre-wrap break-all max-h-48 overflow-auto p-2">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload window
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
