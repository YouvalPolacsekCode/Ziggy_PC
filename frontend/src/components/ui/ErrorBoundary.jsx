// Friendly React error boundary. Catches anything a render or lifecycle
// throws — bad data shapes, undefined.map, child rendering failures — and
// shows a calm "Something went wrong" screen with a retry button.
//
// Wired in two places:
//   - main.jsx wraps the whole tree as the last-resort catch-all
//   - AppShell wraps each route via PageErrorBoundary (route-scoped reset)
//
// The user-facing copy is intentionally generic. Technical detail
// (err.message, stack) is logged to console + the debug bus, never rendered.
// Admins can find the full trace in the Debug page; normal users see a
// premium-feeling "we'll get you back" surface.

import { Component } from 'react'
import { t as i18nT } from '../../lib/i18n'
import logger from '../../lib/logger'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Log via the same channel as API errors so the Debug page surfaces
    // render crashes alongside network failures with one timeline.
    try {
      logger.frontend?.('react_render_error', {
        message: String(error?.message || error || 'unknown'),
        stack: info?.componentStack?.split('\n').slice(0, 8).join('\n'),
        boundary: this.props.label || 'global',
      })
    } catch { /* logger may not be available yet on first paint */ }
    // Console fallback so devs see the real stack regardless of bus state.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || 'global', error, info?.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null })
    // Give the consumer a hook to reset stateful caches when a retry happens
    // (e.g. refetch the data that probably crashed the render). Optional.
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children

    // Allow the consumer to render a custom fallback (e.g. a tiny inline
    // alert inside a card) while keeping the default chrome for the
    // whole-page case.
    if (this.props.renderFallback) {
      return this.props.renderFallback({ retry: this.handleRetry })
    }

    return (
      <div
        role="alert"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center',
          minHeight: this.props.fullHeight === false ? 240 : '60vh',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--warn)', fontSize: 22, fontWeight: 600,
          }}
        >!</div>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          {i18nT('state.errorTitle')}
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', maxWidth: 320, lineHeight: 1.5 }}>
          {i18nT('errors.somethingWentWrong')}
        </p>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            marginTop: 4, padding: '8px 18px', fontSize: 13, fontWeight: 500,
            borderRadius: 10, border: '0.5px solid var(--line)',
            background: 'var(--bg-2)', color: 'var(--ink)', cursor: 'pointer',
          }}
        >
          {i18nT('common.tryAgain')}
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
