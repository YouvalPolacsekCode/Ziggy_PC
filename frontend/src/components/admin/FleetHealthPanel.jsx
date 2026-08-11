import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, HelpCircle, LogIn, RefreshCw, Stethoscope, Wrench, XCircle } from 'lucide-react'
import { Card } from '../ui/Card'
import {
  relayFleetHealth, relayOpsReconcile, relayOpsRecoverHa,
  getOpsRelayConfig, isRelayConfigured, setRelayUrl, setRelayToken, relayLogin,
} from '../../lib/api'

/**
 * Fleet health, straight from the relay's rule engine.
 *
 * Deliberately NOT a second opinion: the verdict rendered here is the same one
 * the CLI and the autonomous remediator act on (relay/app/fleet_health.py). The
 * old console computed its own traffic light in the browser from cpu/disk/mem,
 * which meant three surfaces could each believe something different — and none
 * of them looked at whether the home's devices were actually working.
 *
 * Every row that can be repaired shows the repair. Seeing a problem you can't
 * act on is how alerts get ignored.
 */

const LEVEL_UI = {
  down:     { color: '#ef4444', Icon: XCircle,      label: 'Down' },
  degraded: { color: 'var(--warn)', Icon: AlertTriangle, label: 'Degraded' },
  unknown:  { color: '#6b7280', Icon: HelpCircle,   label: 'Unknown' },
  ok:       { color: 'var(--ok)', Icon: CheckCircle2, label: 'Healthy' },
}

const VERB_UI = {
  'reconcile':  { label: 'Re-scan devices', run: relayOpsReconcile,
                  hint: 'Re-reads Home Assistant and clears devices wrongly marked as removed.' },
  'recover-ha': { label: 'Recover Home Assistant', run: relayOpsRecoverHa,
                  hint: 'Asks the hub to retry its Home Assistant / Zigbee connection.' },
}

function Pill({ level }) {
  const ui = LEVEL_UI[level] || LEVEL_UI.unknown
  const { Icon } = ui
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
      color: ui.color,
      background: `color-mix(in srgb, ${ui.color} 14%, var(--surface))`,
      border: `0.5px solid color-mix(in srgb, ${ui.color} 30%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      <Icon size={12} /> {ui.label}
    </span>
  )
}

function humanAge(seconds) {
  if (seconds == null) return 'never'
  const s = Math.round(seconds)
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function HomeRow({ home, onRepaired }) {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null)

  const runVerb = async (verb) => {
    const spec = VERB_UI[verb]
    if (!spec) return
    setBusy(verb); setResult(null)
    try {
      const res = await spec.run(home.home_id)
      setResult({ ok: true, message: res?.message || 'Done.' })
      onRepaired?.()
    } catch (e) {
      setResult({ ok: false, message: e?.message || 'Failed.' })
    } finally {
      setBusy('')
    }
  }

  const isFine = home.level === 'ok'

  return (
    <div style={{
      padding: '12px 14px', borderTop: '0.5px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Pill level={home.level} />
        <strong style={{ fontSize: 13 }}>{home.name || home.home_id}</strong>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          reported {humanAge(home.silent_for_s)}
        </span>
      </div>

      {!isFine && (
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
          {(home.issues || []).map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <span style={{ color: (LEVEL_UI[issue.level] || LEVEL_UI.unknown).color }}>•</span>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {(home.actionable || []).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {home.actionable.map(verb => {
            const spec = VERB_UI[verb]
            if (!spec) return null
            return (
              <button
                key={verb}
                onClick={() => runVerb(verb)}
                disabled={!!busy}
                title={spec.hint}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, fontWeight: 600, padding: '5px 10px',
                  borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
                  border: '0.5px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              >
                {busy === verb ? <Loader2Spin /> : <Wrench size={12} />} {spec.label}
              </button>
            )
          })}
          {result && (
            <span style={{ fontSize: 11, color: result.ok ? 'var(--ok)' : '#ef4444' }}>
              {result.message}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Loader2Spin() {
  return <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
}

/**
 * Sign-in, shown INSTEAD of hiding the panel.
 *
 * The old behaviour was to render nothing at all when the browser had no relay
 * credentials, which made a fully working fleet look like an empty page and
 * read as "built but broken". A panel that says what it needs is the whole
 * difference.
 */
function RelaySignIn({ relayUrl, onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError('')
    try {
      const res = await relayLogin({ email, password })
      if (!res?.token) throw new Error(res?.detail || 'Sign-in failed.')
      setRelayToken(res.token)
      // Reload rather than just refreshing this panel: every other relay
      // feature on the page (home list, OTA, backups, support sessions) read
      // the token at their own mount, so without this the operator signs in
      // and the rest of the console still looks empty.
      onSignedIn()
      window.location.reload()
    } catch (err) {
      setError(err?.message || 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ padding: '4px 14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', lineHeight: 1.5, margin: 0 }}>
        Sign in to {relayUrl || 'the relay'} to see every home. This browser will
        remember you.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Founder email" type="email" autoComplete="username" dir="auto"
          className="z-input" style={{ flex: '1 1 180px', height: 32, padding: '0 10px', fontSize: 12 }}
        />
        <input
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" type="password" autoComplete="current-password" dir="auto"
          className="z-input" style={{ flex: '1 1 140px', height: 32, padding: '0 10px', fontSize: 12 }}
        />
        <button
          type="submit" disabled={busy || !email || !password} className="z-btn-primary"
          style={{ height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12,
                   display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {busy ? <Loader2Spin /> : <LogIn size={12} />} Sign in
        </button>
      </div>
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
    </form>
  )
}

export default function FleetHealthPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [relayUrl, setRelayUrlState] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // The hub knows its relay; adopt it so nobody has to type a URL. This
      // also unblocks the rest of the ops console, whose relay features are all
      // gated on the same localStorage key.
      if (!isRelayConfigured()) {
        const cfg = await getOpsRelayConfig().catch(() => null)
        const url = cfg?.data?.relay_url
        if (url) { setRelayUrl(url); setRelayUrlState(url) }
      }
      if (!isRelayConfigured()) {
        setError('This hub has no relay configured, so there is no fleet to show.')
        return
      }
      const report = await relayFleetHealth()
      setData(report)
      setNeedsAuth(false)
    } catch (e) {
      // 401/403 means "we know where the relay is, you just aren't signed in" —
      // an invitation, not an error.
      const status = e?.status
      const code = e?.code || ''
      if (status === 401 || status === 403 ||
          code === 'NOT_AUTHENTICATED' || code === 'INSUFFICIENT_PERMISSIONS') {
        setNeedsAuth(true)
      } else {
        setError(e?.userMessage || e?.message || 'Could not reach the relay.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Hubs report every 5 min; refreshing every 60 s keeps the view close to
    // live without hammering the relay. Paused while we're asking for a login.
    const id = setInterval(() => { if (!needsAuth) load() }, 60_000)
    return () => clearInterval(id)
  }, [load, needsAuth])

  const summary = data?.summary
  const worst = summary?.level || 'unknown'
  const ui = LEVEL_UI[worst] || LEVEL_UI.unknown

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 14px 12px', flexWrap: 'wrap',
      }}>
        <Stethoscope size={16} style={{ color: ui.color }} />
        <strong style={{ fontSize: 14 }}>Fleet health</strong>
        {summary && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {summary.counts.ok} healthy · {summary.counts.degraded} degraded ·{' '}
            {summary.counts.down} down · {summary.counts.unknown} unknown
          </span>
        )}
        <button
          onClick={load}
          style={{
            marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
            border: '0.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
          }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading && !data && !needsAuth && (
        <div style={{ padding: '0 14px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
          Checking every home…
        </div>
      )}
      {needsAuth && <RelaySignIn relayUrl={relayUrl} onSignedIn={load} />}
      {error && !needsAuth && (
        <div style={{ padding: '0 14px 14px', fontSize: 12, color: '#ef4444' }}>{error}</div>
      )}
      {data?.homes?.map(h => (
        <HomeRow key={h.home_id} home={h} onRepaired={load} />
      ))}
      {data && data.homes?.length === 0 && (
        <div style={{ padding: '0 14px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
          No homes registered.
        </div>
      )}
    </Card>
  )
}
