// SubscriptionGateBanner — Prompt 9 chunk 3 / decision 5.
//
// Surfaces a persistent banner when the relay's billing gate (proxy.py)
// has refused a recent request. Trigger comes from lib/api.js, which
// dispatches a 'ziggy:subscription-gated' window event whenever it
// normalizes a 403 carrying the "Subscription required for remote
// access" marker.
//
// UX intent (per founder decision):
//   - No crash, no hang on cancelled subscriptions while customer is away
//     from home. The hub still works locally; the banner tells the user
//     remote access is what's offline, not their devices.
//   - The banner auto-clears once any subsequent API call succeeds
//     (success listener wired from lib/api.js side, or by next render
//     pass after the gate flips back to active and the relay 200s).
//
// Sibling status component pattern — small, mounted once at the top of
// App.jsx, no router awareness, decoupled from individual pages.

import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'

const STORAGE_KEY = 'ziggy_subscription_gated_at'

export default function SubscriptionGateBanner() {
  const [shown, setShown] = useState(() => {
    // Re-show across reloads if the flag was set recently (last 24h).
    // Beyond that the cached subscription_state should refresh anyway.
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const ts = parseInt(raw, 10)
      return Number.isFinite(ts) && (Date.now() - ts) < 24 * 60 * 60 * 1000
    } catch { return false }
  })

  useEffect(() => {
    const onGated = () => {
      try { localStorage.setItem(STORAGE_KEY, String(Date.now())) } catch {}
      setShown(true)
    }
    const onCleared = () => {
      try { localStorage.removeItem(STORAGE_KEY) } catch {}
      setShown(false)
    }
    window.addEventListener('ziggy:subscription-gated', onGated)
    window.addEventListener('ziggy:subscription-cleared', onCleared)
    return () => {
      window.removeEventListener('ziggy:subscription-gated', onGated)
      window.removeEventListener('ziggy:subscription-cleared', onCleared)
    }
  }, [])

  if (!shown) return null
  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9000,
        padding: '8px 16px', textAlign: 'center',
        background: '#7a4b00', color: '#fff', fontSize: 13, lineHeight: 1.3,
        boxShadow: '0 1px 0 rgba(0,0,0,0.2)',
      }}
    >
      {t('billing.subscriptionGatedBanner')}
    </div>
  )
}
