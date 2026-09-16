import { useEffect, useState } from 'react'
import { Card } from '../ui/Card'
import { useT } from '../../lib/i18n'

// ── Build indicator ──────────────────────────────────────────────────────────
// Why this exists: there was no way to tell a STALE app from a real bug. A fix
// would ship, the hub would serve it, and the app would keep running an older
// bundle from its cache or from capacitor-updater's staged copy — so a bug that
// had already been fixed looked like it was still there. That cost several
// debugging rounds before anyone suspected the build rather than the code.
//
// The comparison that actually answers it is: the bundle THIS app has loaded
// versus the bundle the hub is serving right now. Both are content hashes in
// the asset filename, so they need no build-time plumbing and cannot drift from
// what is really running.

// Hash out of `assets/index-<hash>.js`, i.e. what this session actually loaded.
function loadedBundleId() {
  try {
    for (const s of document.querySelectorAll('script[src]')) {
      const m = String(s.src).match(/index-([A-Za-z0-9_-]+)\.js/)
      if (m) return m[1]
    }
  } catch { /* fall through */ }
  return null
}

// Hash the hub is serving now, read from its index.html.
async function servedBundleId() {
  const res = await fetch('/?_cb=' + Date.now(), { cache: 'no-store' })
  const html = await res.text()
  return html.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1] || null
}

export default function BuildInfo() {
  const t = useT()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = loadedBundleId()
      let served = null
      let hub = null
      try {
        const v = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json())
        hub = (v?.git_sha || '').slice(0, 7) || null
      } catch { /* hub version is a nice-to-have */ }
      try {
        served = await servedBundleId()
      } catch { /* offline: cannot compare, say so rather than lie */ }
      if (cancelled) return
      const status = !served ? 'unknown' : (loaded && loaded === served ? 'current' : 'stale')
      setState({ status, loaded, served, hub })
    })()
    return () => { cancelled = true }
  }, [])

  const { status, loaded, hub } = state
  const tone = status === 'stale' ? 'var(--accent)' : 'var(--ink-mute)'

  return (
    <Card className="p-4">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{t('settings.build.app')}</span>
          <span style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', color: 'var(--ink)' }}>
            {loaded || '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{t('settings.build.hub')}</span>
          <span style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', color: 'var(--ink)' }}>
            {hub || '—'}
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: tone, marginTop: 4, lineHeight: 1.45 }}>
          {status === 'loading' && t('settings.build.checking')}
          {status === 'current' && t('settings.build.current')}
          {status === 'stale'   && t('settings.build.stale')}
          {status === 'unknown' && t('settings.build.unknown')}
        </p>
      </div>
    </Card>
  )
}
