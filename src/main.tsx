import React, { StrictMode, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle } from 'lucide-react';

// Fonts must be imported before index.css so their @font-face rules land first.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';

import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  props: ErrorBoundaryProps;
  state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Alphatrack Uncaught Error]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-card rounded-xl ring-1 ring-border p-8 text-center shadow-2xl shadow-black/50">
            <div
              className="mx-auto mb-5 flex size-14 items-center justify-center rounded-xl bg-loss/10 ring-1 ring-loss/25 text-loss"
              aria-hidden="true"
            >
              <AlertTriangle className="size-6" />
            </div>

            <h2 className="font-heading text-xl font-semibold text-foreground mb-2">
              Application Render Notice
            </h2>
            <p className="text-[13px] text-muted-foreground leading-relaxed mb-5">
              Alphatrack encountered an issue while loading portfolio data. Click below to reload
              cleanly.
            </p>

            {this.state.error && (
              <pre
                className="bg-surface-2 rounded-lg p-3 mb-6 text-left text-[11px] font-mono text-loss overflow-x-auto max-h-30 whitespace-pre-wrap custom-scrollbar"
                role="alert"
              >
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg bg-brand-fill px-6 py-3 text-[13px] font-semibold text-white transition-colors hover:bg-brand-fill/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer"
              >
                Reload Alphatrack
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }}
                className="rounded-lg bg-surface-3 px-5 py-3 text-[13px] font-medium text-foreground ring-1 ring-border transition-colors hover:bg-surface-3/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer"
              >
                Reset Cache &amp; Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
