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

// `fill` drives the icon and the 12% tint; `text` is the AA-safe word colour.
const LEVEL_UI = {
  down:     { fill: 'var(--err)',       text: 'var(--err-text)',  Icon: XCircle,       label: 'Down' },
  degraded: { fill: 'var(--warn)',      text: 'var(--warn-text)', Icon: AlertTriangle, label: 'Degraded' },
  unknown:  { fill: 'var(--ink-faint)', text: 'var(--ink-mute)',  Icon: HelpCircle,    label: 'Unknown' },
  ok:       { fill: 'var(--ok)',        text: 'var(--ok-text)',   Icon: CheckCircle2,  label: 'Healthy' },
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
    <span className="z-chip" style={{
      gap: 6, color: ui.text,
      background: `color-mix(in srgb, ${ui.fill} 12%, var(--surface))`,
      borderColor: `color-mix(in srgb, ${ui.fill} 30%, var(--line))`,
      whiteSpace: 'nowrap',
    }}>
      <Icon size={16} strokeWidth={1.75} style={{ color: ui.fill }} /> {ui.label}
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
      padding: '12px 16px', borderTop: '0.5px solid var(--line)',
      display: 'flex', flexDirection: 'column', gap: 8, minHeight: 56,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Pill level={home.level} />
        <strong className="z-headline">{home.name || home.home_id}</strong>
        <span className="z-footnote z-mono">
          reported {humanAge(home.silent_for_s)}
        </span>
      </div>

      {!isFine && (
        <div style={{ fontSize: 15, color: 'var(--ink)', lineHeight: '20px' }}>
          {(home.issues || []).map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="z-dot" style={{ background: (LEVEL_UI[issue.level] || LEVEL_UI.unknown).fill }} />
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
                className="z-btn-secondary"
                style={{ cursor: busy ? 'wait' : 'pointer' }}
              >
                {busy === verb ? <Loader2Spin /> : <Wrench size={18} strokeWidth={1.75} />} {spec.label}
              </button>
            )
          })}
          {result && (
            <span style={{ fontSize: 15, color: result.ok ? 'var(--ok-text)' : 'var(--err-text)' }}>
              {result.message}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Loader2Spin() {
  return <RefreshCw size={18} strokeWidth={1.75} className="z-spin" />
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
    <form onSubmit={submit} style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="z-subhead" style={{ margin: 0 }}>
        Sign in to {relayUrl || 'the relay'} to see every home. This browser will
        remember you.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Founder email" type="email" autoComplete="username" dir="auto"
          className="z-input" style={{ flex: '1 1 200px', width: 'auto' }}
        />
        <input
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" type="password" autoComplete="current-password" dir="auto"
          className="z-input" style={{ flex: '1 1 160px', width: 'auto' }}
        />
        <button type="submit" disabled={busy || !email || !password} className="z-btn-primary">
          {busy ? <Loader2Spin /> : <LogIn size={18} strokeWidth={1.75} />} Sign in
        </button>
      </div>
      {error && <span style={{ fontSize: 15, color: 'var(--err-text)' }}>{error}</span>}
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
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 16px 12px', flexWrap: 'wrap',
      }}>
        <Stethoscope size={20} strokeWidth={1.75} style={{ color: ui.fill }} />
        <strong className="z-headline">Fleet health</strong>
        {summary && (
          <span className="z-subhead z-mono">
            {summary.counts.ok} healthy · {summary.counts.degraded} degraded ·{' '}
            {summary.counts.down} down · {summary.counts.unknown} unknown
          </span>
        )}
        <button onClick={load} className="z-btn-secondary" style={{ marginInlineStart: 'auto' }}>
          <RefreshCw size={18} strokeWidth={1.75} className={loading ? 'z-spin' : undefined} /> Refresh
        </button>
      </div>

      {loading && !data && !needsAuth && (
        <p className="z-subhead" style={{ padding: '0 16px 16px' }}>
          Checking every home…
        </p>
      )}
      {needsAuth && <RelaySignIn relayUrl={relayUrl} onSignedIn={load} />}
      {error && !needsAuth && (
        <div style={{ padding: '0 16px 16px', fontSize: 15, color: 'var(--err-text)' }}>{error}</div>
      )}
      {data?.homes?.map(h => (
        <HomeRow key={h.home_id} home={h} onRepaired={load} />
      ))}
      {data && data.homes?.length === 0 && (
        <p className="z-subhead" style={{ padding: '0 16px 16px' }}>
          No homes registered.
        </p>
      )}
    </Card>
  )
}
