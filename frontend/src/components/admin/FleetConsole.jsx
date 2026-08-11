import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, HelpCircle, LogIn, RefreshCw, Wrench, XCircle,
} from 'lucide-react'
import {
  relayFleetHealth, relayFleetActivity, relayOpsReconcile, relayOpsRecoverHa,
  getOpsRelayConfig, isRelayConfigured, setRelayUrl, setRelayToken, relayLogin,
} from '../../lib/api'

/**
 * Fleet console — the operator's answer to three questions, in the order they
 * are actually asked:
 *
 *   1. Is anything wrong right now?   → the verdict line
 *   2. How is each home?              → one row per home
 *   3. What changed?                  → recent activity
 *
 * Written for someone who runs HOMES, not servers. Every home states its
 * condition as a sentence; the telemetry sits underneath in a quiet monospace
 * strip you can read when you care and ignore when you don't. That ordering is
 * the whole design: a wall of metrics would technically contain the same facts
 * and answer none of the questions.
 *
 * Colour means state and nothing else. A healthy fleet is three grey lines with
 * a green mark — deliberately unexciting, so that anything coloured is worth
 * looking at.
 */

const LEVEL = {
  down:     { color: '#D64545', label: 'down',     Icon: XCircle },
  degraded: { color: 'var(--warn)', label: 'degraded', Icon: AlertTriangle },
  unknown:  { color: 'var(--ink-faint)', label: 'unknown', Icon: HelpCircle },
  ok:       { color: 'var(--ok)', label: 'ok',     Icon: CheckCircle2 },
}

const VERBS = {
  'reconcile':  {
    label: 'Re-scan devices',
    run: relayOpsReconcile,
    hint: 'Re-reads Home Assistant and clears devices wrongly marked as removed.',
  },
  'recover-ha': {
    label: 'Reconnect Home Assistant',
    run: relayOpsRecoverHa,
    hint: 'Asks the hub to retry its Home Assistant and Zigbee connection.',
  },
}

const MONO = '"IBM Plex Mono", ui-monospace, monospace'

// ── formatting ─────────────────────────────────────────────────────────────

function ago(seconds) {
  if (seconds == null) return 'never'
  const s = Math.round(seconds)
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function uptime(seconds) {
  if (!seconds) return null
  const h = Math.round(seconds / 3600)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

function clockOf(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** The headline. Names the problem rather than counting it, when it can. */
function verdictLine(report) {
  const homes = report?.homes || []
  if (!homes.length) return 'No homes yet.'
  const bad = homes.filter(h => h.level === 'down' || h.level === 'degraded')
  const down = homes.filter(h => h.level === 'down')

  if (down.length === 1) return `${down[0].name} is down.`
  if (down.length > 1) return `${down.length} homes are down.`
  if (bad.length === 1) return `${bad[0].name} needs a look.`
  if (bad.length > 1) return `${bad.length} homes need a look.`

  const unknown = homes.filter(h => h.level === 'unknown' && !h.suspended)
  if (unknown.length) return `${unknown.length} of ${homes.length} homes haven't reported in.`
  return 'Everything\'s fine.'
}

// ── pieces ─────────────────────────────────────────────────────────────────

function Dot({ level, size = 7 }) {
  const c = (LEVEL[level] || LEVEL.unknown).color
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: c,
      display: 'inline-block', flexShrink: 0,
    }} />
  )
}

/** Version convergence. Drift is the failure that hides, so it gets a line of
 *  its own rather than a column you have to compare down. */
function Convergence({ versions, total }) {
  if (!versions || !total) return null
  const entries = Object.entries(versions.counts || {})
  if (!entries.length) return null

  if (versions.converged) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span>All {total} on</span>
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--ink)' }}>{versions.majority}</span>
      </div>
    )
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--warn)', display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <span>Split across {entries.length} versions:</span>
      {entries.map(([tag, n]) => (
        <span key={tag} style={{ fontFamily: MONO, fontSize: 11.5 }}>
          {tag}&nbsp;×{n}
        </span>
      ))}
    </div>
  )
}

/** The instrument strip. Present but subordinate — you read the sentence
 *  first, and drop to these only when you want the detail. */
function Vitals({ v }) {
  if (!v) return null
  const cells = []
  if (v.devices_total != null) {
    cells.push(['devices', v.devices_offline
      ? `${v.devices_total} · ${v.devices_offline} off`
      : `${v.devices_total}`])
  }
  if (v.disk_pct != null) cells.push(['disk', `${Math.round(v.disk_pct)}%`])
  if (v.mem_pct != null) cells.push(['memory', `${Math.round(v.mem_pct)}%`])
  const up = uptime(v.uptime_s)
  if (up) cells.push(['up', up])
  if (v.ha_version) cells.push(['home assistant', v.ha_version])

  // The release belongs in this same row, not pushed to the far edge: an
  // auto-margin orphaned it onto its own line and left a ragged gap.
  if (v.release_tag) {
    // "release release-2026.08.11-4" stutters. The label already says release,
    // so the value doesn't need to repeat it.
    const short = String(v.release_tag).replace(/^release-/, '')
    cells.push(['release', `${short}${v.cohort ? ` · ${v.cohort}` : ''}`])
  }

  return (
    <div style={{
      display: 'flex', gap: '4px 16px', flexWrap: 'wrap', alignItems: 'baseline',
      fontFamily: MONO, fontSize: 11, color: 'var(--ink-faint)',
    }}>
      {cells.map(([k, val]) => (
        <span key={k}>
          {k}{' '}
          <span style={{
            color: k === 'release' && v.drifted ? 'var(--warn)' : 'var(--ink-mute)',
          }}>
            {val}
          </span>
        </span>
      ))}
    </div>
  )
}

function HomeRow({ home, onChanged }) {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null)
  const ui = LEVEL[home.level] || LEVEL.unknown
  const fine = home.level === 'ok'

  const run = async (verb) => {
    const spec = VERBS[verb]
    if (!spec) return
    setBusy(verb); setResult(null)
    try {
      const res = await spec.run(home.home_id)
      setResult({ ok: true, text: res?.message || 'Done.' })
      onChanged?.()
    } catch (e) {
      setResult({ ok: false, text: e?.userMessage || e?.message || 'That didn\'t work.' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{
      display: 'flex', gap: 13, padding: '13px 0', alignItems: 'stretch',
      borderTop: '0.5px solid var(--line)',
    }}>
      {/* State rail — the one piece of colour that carries meaning. Full height
          so it reads as the row's edge rather than a stray mark. */}
      <div style={{
        width: 2.5, borderRadius: 2, background: ui.color, flexShrink: 0,
        opacity: fine ? 0.5 : 1,
      }} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)' }}>
            {home.name || home.home_id}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            reported {ago(home.silent_for_s)}
          </span>
          <span style={{
            marginInlineStart: 'auto', fontSize: 11, fontWeight: 600,
            color: fine ? 'var(--ink-faint)' : ui.color,
          }}>
            {ui.label}
          </span>
        </div>

        {/* What is true about this home, in words. */}
        {fine ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-mute)' }}>All good.</p>
        ) : (
          // A bullet in front of a single line is decoration, not structure —
          // markers only earn their place once there is a list to scan.
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {(home.issues || []).map((issue, i) => (
              <li key={i} style={{
                fontSize: 13, color: 'var(--ink)', display: 'flex', gap: 7,
                alignItems: 'baseline',
              }}>
                {(home.issues || []).length > 1 && <Dot level={issue.level} size={5} />}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}

        <Vitals v={home.vitals} />

        {(home.actionable || []).length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
            {home.actionable.map(verb => {
              const spec = VERBS[verb]
              if (!spec) return null
              return (
                <button
                  key={verb}
                  onClick={() => run(verb)}
                  disabled={!!busy}
                  title={spec.hint}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 11.5, fontWeight: 600, padding: '5px 11px',
                    borderRadius: 8, cursor: busy ? 'progress' : 'pointer',
                    border: '0.5px solid var(--line)', background: 'var(--surface)',
                    color: 'var(--ink)', fontFamily: 'inherit',
                  }}
                >
                  {busy === verb
                    ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Wrench size={12} />}
                  {spec.label}
                </button>
              )
            })}
            {result && (
              <span style={{ fontSize: 11.5, color: result.ok ? 'var(--ok)' : '#D64545' }}>
                {result.text}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Who the event is about. A deleted home no longer has a row to join to, so
 *  its name is recovered from the snapshot taken before it was removed —
 *  otherwise the line reads "fleet removed from the fleet". */
function activitySubject(row) {
  if (row.name) return row.name
  if (row.event === 'fleet_home_deleted' && row.detail) {
    try {
      const snap = JSON.parse(row.detail)
      if (snap?.name) return snap.name
    } catch { /* detail isn't always JSON */ }
  }
  return row.home_id || 'Fleet'
}

/** Reads an audit row into one line of English. */
function activityLine(row) {
  const detail = row.detail || ''
  switch (row.event) {
    case 'home_version_changed':  return `updated — ${detail}`
    case 'fleet_auto_repair':     return `repaired itself — ${detail}`
    case 'fleet_home_deleted':    return 'removed from the fleet'
    case 'register_hub':          return 'registered with the relay'
    case 'home_provisioned':      return 'provisioned'
    case 'support_session_opened':return 'support session opened'
    case 'backup_restored':       return 'backup restored'
    default:                      return `${row.event}${detail ? ` — ${detail}` : ''}`
  }
}

function dayLabel(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function Activity({ rows }) {
  if (!rows) return null
  if (!rows.length) {
    return (
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>
        Nothing yet. Updates, automatic repairs and new homes show up here.
      </p>
    )
  }

  // Group by day. Without this, a 10:31 PM entry from yesterday sits directly
  // under 06:58 PM from today and the feed reads as though time ran backwards.
  let lastDay = null
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => {
        const day = dayLabel(r.ts)
        const newDay = day !== lastDay
        lastDay = day
        return (
          <div key={i}>
            {newDay && (
              <div style={{
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--ink-faint)',
                paddingTop: i === 0 ? 0 : 12, paddingBottom: 4,
              }}>
                {day}
              </div>
            )}
            <div style={{
              display: 'flex', gap: 12, padding: '6px 0', alignItems: 'baseline',
              borderTop: newDay ? 'none' : '0.5px dashed var(--line)',
            }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-faint)', flexShrink: 0 }}>
                {clockOf(r.ts)}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--ink)', minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{activitySubject(r)}</span>
                {' '}
                <span style={{ color: r.ok === 0 ? '#D64545' : 'var(--ink-mute)' }}>
                  {activityLine(r)}
                </span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SignIn({ relayUrl, onDone }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError('')
    try {
      const res = await relayLogin({ email, password })
      if (!res?.token) throw new Error(res?.detail || 'That email and password didn\'t work.')
      setRelayToken(res.token)
      onDone()
      window.location.reload()
    } catch (err) {
      setError(err?.message || 'That email and password didn\'t work.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
        Sign in to <span style={{ fontFamily: MONO, fontSize: 11.5 }}>{relayUrl || 'the relay'}</span> to
        see every home. This browser will remember you.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Founder email"
          type="email" autoComplete="username" dir="auto" className="z-input"
          style={{ flex: '1 1 200px', height: 34, padding: '0 11px', fontSize: 12.5 }} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
          type="password" autoComplete="current-password" dir="auto" className="z-input"
          style={{ flex: '1 1 150px', height: 34, padding: '0 11px', fontSize: 12.5 }} />
        <button type="submit" disabled={busy || !email || !password} className="z-btn-primary"
          style={{ height: 34, padding: '0 15px', borderRadius: 9, fontSize: 12.5,
                   display: 'flex', alignItems: 'center', gap: 6 }}>
          {busy ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <LogIn size={12} />}
          Sign in
        </button>
      </div>
      {error && <span style={{ fontSize: 11.5, color: '#D64545' }}>{error}</span>}
    </form>
  )
}

// ── console ────────────────────────────────────────────────────────────────

export default function FleetConsole() {
  const [report, setReport] = useState(null)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')
  const [needsAuth, setNeedsAuth] = useState(false)
  const [relayUrl, setRelayUrlState] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // The hub knows its own relay, so nobody has to type a URL. This also
      // unblocks the rest of the page, which gates on the same stored value.
      if (!isRelayConfigured()) {
        const cfg = await getOpsRelayConfig().catch(() => null)
        const url = cfg?.data?.relay_url
        if (url) { setRelayUrl(url); setRelayUrlState(url) }
      }
      if (!isRelayConfigured()) {
        setError('This hub has no relay configured, so there is no fleet to show.')
        return
      }
      const [health, acts] = await Promise.all([
        relayFleetHealth(),
        relayFleetActivity(25).catch(() => ({ activity: [] })),
      ])
      setReport(health)
      setActivity(acts?.activity || [])
      setLoadedAt(new Date())
      setNeedsAuth(false)
    } catch (e) {
      const unauthorized = e?.status === 401 || e?.status === 403
        || e?.code === 'NOT_AUTHENTICATED' || e?.code === 'INSUFFICIENT_PERMISSIONS'
      if (unauthorized) setNeedsAuth(true)
      else setError(e?.userMessage || e?.message || 'Can\'t reach the relay right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (!needsAuth) load() }, 60_000)
    return () => clearInterval(id)
  }, [load, needsAuth])

  const summary = report?.summary
  const counts = summary?.counts || {}
  const homes = report?.homes || []
  const shown = homes.filter(h => !h.suspended)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* ── 1. Is anything wrong? ───────────────────────────────────────── */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--ink-faint)',
          }}>
            Fleet
          </span>
          <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {loadedAt && (
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-faint)' }}>
                {loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={load} title="Refresh now" aria-label="Refresh now"
              style={{
                display: 'inline-flex', alignItems: 'center', background: 'transparent',
                border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 2,
              }}
            >
              <RefreshCw size={12} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
            </button>
          </span>
        </div>

        {!needsAuth && !error && (
          <>
            <h2 style={{
              margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em',
              color: 'var(--ink)', lineHeight: 1.2,
            }}>
              {loading && !report ? 'Checking every home…' : verdictLine(report)}
            </h2>
            {report && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-mute)' }}>
                  {['ok', 'degraded', 'down', 'unknown'].map(k => (
                    counts[k] ? (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Dot level={k} /> {counts[k]} {LEVEL[k].label === 'ok' ? 'healthy' : LEVEL[k].label}
                      </span>
                    ) : null
                  ))}
                </span>
                <span style={{ marginInlineStart: 'auto' }}>
                  <Convergence versions={report.versions} total={shown.length} />
                </span>
              </div>
            )}
          </>
        )}
      </header>

      {needsAuth && <SignIn relayUrl={relayUrl} onDone={load} />}

      {error && !needsAuth && (
        <p style={{ margin: 0, fontSize: 12.5, color: '#D64545' }}>{error}</p>
      )}

      {/* ── 2. How is each home? ────────────────────────────────────────── */}
      {!needsAuth && report && (
        <div>
          {shown.map(h => <HomeRow key={h.home_id} home={h} onChanged={load} />)}
          {shown.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: 0 }}>
              No homes yet. Create one with New home above.
            </p>
          )}
        </div>
      )}

      {/* ── 3. What changed? ────────────────────────────────────────────── */}
      {!needsAuth && activity && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--ink-faint)',
          }}>
            Recent
          </span>
          <Activity rows={activity} />
        </div>
      )}
    </section>
  )
}
