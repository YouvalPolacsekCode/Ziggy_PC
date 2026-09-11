// <DataState/> — the canonical wrapper for the four UI states a data fetch
// can be in: loading, empty, error, ready. Replaces the ad-hoc
// `{loading ? ... : error ? ... : data.length ? ... : ...}` ladders that
// were leaving pages blank on failure or rendering raw error text.
//
// Usage:
//
//   const { data, loading, error, refetch } = useThing()
//   <DataState
//     loading={loading}
//     error={error}
//     empty={!data || data.length === 0}
//     onRetry={refetch}
//     renderEmpty={() => <p>{t('thing.empty')}</p>}
//   >
//     {data.map(...)}
//   </DataState>
//
// The error branch never renders err.message directly. It runs the error
// through describeError() so the user sees a localized, sanitized string,
// and gets a retry button when the error is classified as retryable.

import { describeError } from '../../lib/errors'
import { t as i18nT } from '../../lib/i18n'

function DefaultSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 120, padding: 24,
        color: 'var(--ink-mute)', fontSize: 13,
      }}
    >
      {i18nT('state.loading')}
    </div>
  )
}

function DefaultEmpty({ message }) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 8, minHeight: 120, padding: 24,
        color: 'var(--ink-mute)', fontSize: 13, textAlign: 'center',
      }}
    >
      <p>{message || i18nT('state.empty')}</p>
    </div>
  )
}

function DefaultError({ message, requestId, retryable, onRetry }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, minHeight: 160, padding: 24,
        textAlign: 'center',
      }}
    >
      <p className="z-headline" style={{ margin: 0 }}>
        {i18nT('state.errorTitle')}
      </p>
      <p className="z-subhead" style={{ margin: 0, maxWidth: 320, lineHeight: 1.5 }}>
        {message}
      </p>
      {retryable && onRetry && (
        <button type="button" onClick={onRetry} className="z-btn-secondary" style={{ marginTop: 4 }}>
          {i18nT('common.tryAgain')}
        </button>
      )}
      {requestId && (
        // Small but still AA: --ink-faint at full opacity is 5.9:1 on white.
        <p className="z-footnote z-code" style={{ margin: 0, color: 'var(--ink-faint)' }}>
          {i18nT('errors.requestId', { id: requestId })}
        </p>
      )}
    </div>
  )
}

/**
 * Props:
 *   loading        boolean — show skeleton/spinner
 *   error          any     — anything thrown by the data layer; described via describeError()
 *   empty          boolean — show the empty state instead of children when no error/loading
 *   onRetry        () => void — wired to the error-state Try Again button (only shown when retryable)
 *   renderSkeleton ({}) => node — override the default spinner
 *   renderEmpty    ({}) => node — override the default empty state
 *   renderError    ({ message, requestId, retryable, onRetry }) => node — override the default error state
 *   emptyMessage   string  — quick shortcut for a custom empty message without renderEmpty
 *   children       node    — rendered only when not loading / not empty / no error
 *
 * Priority order:
 *   error > loading > empty > children
 * Putting error first means a stale fetch that errored doesn't get hidden
 * behind a "loading" indicator on subsequent refetch — the user sees the
 * problem until they retry.
 */
export function DataState({
  loading,
  error,
  empty,
  onRetry,
  renderSkeleton,
  renderEmpty,
  renderError,
  emptyMessage,
  children,
}) {
  if (error) {
    const desc = describeError(error)
    if (renderError) return renderError({ ...desc, onRetry })
    return <DefaultError {...desc} onRetry={onRetry} />
  }
  if (loading) {
    return renderSkeleton ? renderSkeleton() : <DefaultSkeleton />
  }
  if (empty) {
    return renderEmpty ? renderEmpty() : <DefaultEmpty message={emptyMessage} />
  }
  return children
}

export default DataState
