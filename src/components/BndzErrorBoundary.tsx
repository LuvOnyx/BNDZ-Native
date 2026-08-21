import React from 'react';

type Props = {
  children: React.ReactNode;
  label?: string;
  /**
   * Soft isolate for leaf surfaces (preview / 3D). Catch the error, notify,
   * and render fallback — do NOT blank the whole native shell.
   */
  isolate?: boolean;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
  /** Reset isolation when this key changes (e.g. selected file path). */
  resetKey?: string | number | null;
};

type State = {
  error: Error | null;
};

/**
 * Keep a render crash from wiping the whole native shell to a blank dark HWND.
 * Use isolate+fallback around GPU / stream preview so a single bad texture
 * cannot take down BNDZUI.
 */
export default class BndzErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      this.props.onError?.(error);
    } catch { /* ignore */ }

    // Only escalate to the host chrome for hard (non-isolated) failures.
    if (!this.props.isolate) {
      try {
        const wv = (window as Window & { chrome?: { webview?: { postMessage: (msg: unknown) => void } } }).chrome?.webview;
        wv?.postMessage?.({
          type: 'BNDZ_UI_CRASH',
          payload: {
            message: error?.message || String(error),
            stack: error?.stack,
            componentStack: info?.componentStack,
            label: this.props.label || 'BNDZUI',
          },
        });
      } catch { /* ignore */ }
    }
    console.error('[BndzErrorBoundary]', this.props.label || 'BNDZ', error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.isolate) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 bg-[#0C0F14]/80 px-6 text-center">
          <div className="text-[13px] font-semibold text-[#e8eef6]">
            {this.props.label || 'Panel'} failed to render
          </div>
          <div className="max-w-md text-[11px] leading-relaxed text-[#9CA3AF]">
            {this.state.error.message || 'Unknown error'}
          </div>
          <button
            type="button"
            className="mt-1 rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-[#c5cdd6] hover:bg-white/10"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-3 bg-[#0C0F14] px-8 text-center">
        <div className="text-[15px] font-semibold tracking-wide text-[#e8eef6]">
          {this.props.label || 'BNDZ'} hit a render error
        </div>
        <div className="max-w-xl text-[12px] leading-relaxed text-[#9CA3AF]">
          {this.state.error.message || 'Unknown error'}
        </div>
        <button
          type="button"
          className="mt-2 rounded-[12px] border border-white/15 bg-white/5 px-4 py-2 text-[12px] text-[#c5cdd6] hover:bg-white/10"
          onClick={() => {
            this.setState({ error: null });
            try { window.location.reload(); } catch { /* ignore */ }
          }}
        >
          Reload UI
        </button>
      </div>
    );
  }
}
