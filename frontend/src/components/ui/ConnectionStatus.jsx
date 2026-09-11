// Friendly connection banner. Shown at the top of the app shell when the
// network status is anything other than "online". Replaces the old single-
// state "Offline — reconnecting…" banner with three distinct messages so the
// copy actually matches what's happening:
//
//   - status 'connecting' (WS down, network up):   "Reconnecting to Ziggy…"
//   - status 'offline'    (no network at all):     "You're offline"
//   - status 'online'     → banner hidden
//
// Debounce: a 2s delay before showing anything so server restarts and Vite
// HMR cycles don't flash a scary banner. Same threshold the old AppShell
// implementation used — proven to filter out noise without hiding genuine
// outages.
//
// Color: amber for "connecting" (transient), red for "offline" (action-
// required). Text is --on-accent (near-black) rather than white: white on the
// light-palette --warn fill is 3.8:1, --on-accent is 4.5:1 on the same fill.

import { useEffect, useState } from 'react'
import { t as i18nT } from '../../lib/i18n'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'

const DEBOUNCE_MS = 2_000

export function ConnectionStatus() {
  const { status } = useNetworkStatus()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (status === 'online') {
      setVisible(false)
      return
    }
    const t = setTimeout(() => setVisible(true), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [status])

  if (!visible || status === 'online') return null

  const isOffline = status === 'offline'
  const bg = isOffline ? 'var(--err)' : 'var(--warn)'
  const text = isOffline ? i18nT('status.offline') : i18nT('status.reconnecting')

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: bg, color: 'var(--on-accent)',
        fontSize: 13, fontWeight: 500, textAlign: 'center', padding: '8px 16px',
        animation: 'ziggy-banner-in var(--dur-enter) var(--ease-enter)',
      }}
    >
      <style>{`@keyframes ziggy-banner-in {
        from { transform: translateY(-100%); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }`}</style>
      {text}
    </div>
  )
}

export default ConnectionStatus
