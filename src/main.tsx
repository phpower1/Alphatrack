import React, { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
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
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0d0e12',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            maxWidth: '500px',
            width: '100%',
            backgroundColor: '#13141a',
            border: '1px solid #334155',
            borderRadius: '16px',
            padding: '32px',
            textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto',
              color: '#f87171',
              fontSize: '24px'
            }}>
              ⚠️
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#ffffff' }}>
              Application Render Notice
            </h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.6', margin: '0 0 20px 0' }}>
              Alphatrack encountered an issue while loading portfolio data. Click below to reload cleanly.
            </p>
            {this.state.error && (
              <div style={{
                backgroundColor: '#1e293b',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#fca5a5',
                textAlign: 'left',
                marginBottom: '24px',
                overflowX: 'auto',
                maxHeight: '120px'
              }}>
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  backgroundColor: '#4f46e5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px 24px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Reload Alphatrack
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }}
                style={{
                  backgroundColor: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #475569',
                  borderRadius: '10px',
                  padding: '12px 20px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Reset Cache & Reload
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



