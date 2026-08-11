import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './ops.css'
import {
  relayFleetHealth, relayFleetActivity,
  relayOpsReconcile, relayOpsRecoverHa,
  relayGetHome, relayHomeTelemetry, relayHomeBackupStatus, relayHomeMobileDevices,
  relayOpenSupportSession, relayCreateInvite, relayDeprovision,
  getOpsRelayConfig, isRelayConfigured, setRelayUrl, setRelayToken, relayLogin,
} from '../../../lib/api'

/**
 * Ziggy Ops — the fleet console.
 *
 * Implements the Claude Design "Ziggy Fleet Console" against live data: every
 * number, state and event on this screen comes from the relay, and every button
 * calls a real endpoint. Where an action has no real backing it is disabled and
 * says why, rather than pretending.
 *
 * Structure follows the design: a fleet list sorted so a broken home is always
 * first, an events log, and a per-home detail view.
 */

const REPAIRS = {
  'reconcile':  { label: 'Re-scan devices', run: relayOpsReconcile },
  'recover-ha': { label: 'Reconnect Home Assistant', run: relayOpsRecoverHa },
}

const SEV_RANK = { down: 0, degraded: 1, unknown: 2, ok: 3 }
const STATE_WORD = { down: 'DOWN', degraded: 'DEGRADED', unknown: 'UNKNOWN', ok: 'HEALTHY' }

// ── formatting ─────────────────────────────────────────────────────────────

const fmtAgo = (s) => {
  if (s == null) return 'never'
  const n = Math.round(s)
  if (n < 90) return `${n}s ago`
  if (n < 5400) return `${Math.round(n / 60)} min ago`
  if (n < 172800) return `${Math.round(n / 3600)}h ago`
  return `${Math.round(n / 86400)}d ago`
}
const fmtUptime = (s) => {
  if (!s) return '—'
  const h = Math.round(s / 3600)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}
const clock = (iso) => {
  const t = Date.parse(iso)
  // 24-hour: an ops log is scanned, not read aloud, and 'PM' wrapped the column.
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
}
const dayLabel = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'Earlier'
  const d = new Date(t), now = new Date()
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, now)) return `Today · ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}`
  if (same(d, new Date(now.getTime() - 86400000))) return `Yesterday · ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}`
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}
const shortRelease = (tag) => {
  if (!tag) return null
  const m = String(tag).match(/-(\d+)-g[0-9a-f]{7,}$/)
  const base = (m ? String(tag).slice(0, m.index) : String(tag)).replace(/^release-/, '')
  return m ? `${base} +${m[1]}` : base
}

// Square state marks. The design uses shape as well as colour — a dashed
// outline for unknown, a hairline square for healthy — so state survives
// greyscale and colour-blindness.
function Mark({ sev, size = 9 }) {
  const base = { display: 'inline-block', width: size, height: size, flex: 'none' }
  const style =
    sev === 'down' ? { ...base, background: 'var(--down)' } :
    sev === 'degraded' || sev === 'warn' ? { ...base, background: 'var(--warn)' } :
    sev === 'unknown' || sev === 'unk' ? { ...base, border: '1px dashed var(--color-neutral-500)' } :
    sev === 'acc' ? { ...base, background: 'var(--color-accent)' } :
    { ...base, border: '1px solid var(--color-neutral-500)' }
  return <span style={style} />
}

function Corners() {
  return <><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>
}

// ── issues ─────────────────────────────────────────────────────────────────

function IssueRow({ issue, homeId, disabled, disabledNote, onDone, toast }) {
  const [state, setState] = useState('idle')
  const [result, setResult] = useState(null)
  const spec = issue.remedy ? REPAIRS[issue.remedy] : null

  const run = async (e) => {
    e.stopPropagation()
    setState('running'); setResult(null)
    try {
      const res = await spec.run(homeId)
      const ok = res?.status === 'ok'
      setResult({ ok, text: res?.message || (ok ? 'Done.' : 'Failed.') })
      toast(`${ok ? 'Repair succeeded' : 'Repair failed'}: ${spec.label}`)
      onDone?.()
    } catch (err) {
      setResult({ ok: false, text: err?.userMessage || err?.message || 'Failed.' })
      toast(`Repair failed: ${spec.label}`)
    } finally {
      setState('done')
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
      <Mark sev={issue.level} />
      <span style={{ flex: 1, minWidth: 200 }}>{issue.message}</span>
      {spec && (
        <>
          {result && (
            <span style={{ fontSize: 12, color: result.ok ? 'var(--color-text)' : 'var(--down-800)' }}>
              {result.text}
            </span>
          )}
          <button
            className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }}
            onClick={run} disabled={state === 'running' || disabled}
            title={disabled ? disabledNote : undefined}
          >
            {state === 'running' ? 'Running…' : spec.label}
          </button>
        </>
      )}
      {issue.kind === 'human' && (
        <span style={{ fontSize: 11 }} className="text-muted">no safe repair — needs a human</span>
      )}
      {issue.kind === 'context' && (
        <span style={{ fontSize: 11 }} className="text-muted">context, not actionable</span>
      )}
    </div>
  )
}

// ── fleet table ────────────────────────────────────────────────────────────

const GRID = '104px 1.15fr 110px 1.5fr 64px 56px 150px 34px'

function FleetRow({ home, expanded, onToggle, onOpen, onRepaired, toast }) {
  const v = home.vitals || {}
  const st = home.level
  const silent = st === 'down'
  const stColor = st === 'down' ? 'var(--down-800)'
    : st === 'degraded' ? 'var(--warn-800)'
    : 'color-mix(in srgb, var(--color-text) 55%, transparent)'

  const issues = home.issues || []
  const summary = issues.length === 0 ? '—'
    : issues.length === 1 ? issues[0].message
    : `${issues.length} issues — ${issues.map(i => i.message.split('—')[0].trim().toLowerCase()).join(', ')}`

  const rel = shortRelease(v.release_tag)
  const relStyle = !rel ? { fontSize: 12, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }
    : v.cohort === 'canary' ? { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', fontSize: 11, padding: '2px 8px' }
    : v.drifted ? { background: 'var(--warn-100)', color: 'var(--warn-800)', border: '1px solid var(--warn)', fontSize: 11, padding: '2px 8px' }
    : { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-800)', fontSize: 11, padding: '2px 8px' }

  return (
    <div>
      <div
        className="zg-row"
        onClick={onOpen}
        style={{
          display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 8,
          cursor: 'pointer', padding: '8px', borderBottom: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
          background: st === 'down' ? 'var(--down-100)' : 'transparent',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: st === 'down' ? 700 : st === 'degraded' ? 600 : 400, color: stColor }}>
          <Mark sev={st} /> {STATE_WORD[st] || 'UNKNOWN'}
        </span>
        <span style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <strong>{home.name}</strong>{' '}
          <span style={{ fontSize: 12 }} className="text-muted">{(home.owner_email || '').split('@')[0]}</span>
        </span>
        <span style={{ fontSize: 13, color: silent ? 'var(--down-800)' : 'color-mix(in srgb, var(--color-text) 60%, transparent)', fontWeight: silent ? 600 : 400 }}>
          {home.silent_for_s == null ? 'never' : fmtAgo(home.silent_for_s)}
        </span>
        <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: issues.length ? 'var(--color-text)' : 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>
          {summary}
        </span>
        <span style={{ fontSize: 13 }}>
          {v.devices_total == null ? '—' : (v.devices_offline ? `${v.devices_total - v.devices_offline}/${v.devices_total}` : v.devices_total)}
        </span>
        <span style={{ fontSize: 13, color: v.disk_pct >= 85 ? 'var(--warn-800)' : 'inherit' }}>
          {v.disk_pct == null ? '—' : `${Math.round(v.disk_pct)}%`}
        </span>
        <span><span style={relStyle}>{rel || '—'}{v.cohort === 'canary' ? ' · canary' : ''}</span></span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: .6, fontSize: 12, padding: 4 }}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && (
        <div style={{
          padding: '12px 16px 14px', background: 'color-mix(in srgb, var(--color-text) 3%, transparent)',
          borderBottom: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column', gap: 9,
        }}>
          {issues.map((iss, i) => (
            <IssueRow
              key={i} issue={iss} homeId={home.home_id}
              disabled={silent} disabledNote="The hub can't hear us while it's silent."
              onDone={onRepaired} toast={toast}
            />
          ))}
          {issues.length === 0 && <div style={{ fontSize: 12 }} className="text-muted">No issues.</div>}
          {silent && (
            <div style={{ fontSize: 11, borderTop: '1px solid var(--color-divider)', paddingTop: 8 }} className="text-muted">
              Repairs disabled — the hub can't hear us while it's silent.
            </div>
          )}
          <div>
            <a href="#" onClick={(e) => { e.preventDefault(); onOpen() }} style={{ fontSize: 12, textDecoration: 'none' }}>Open home →</a>
          </div>
        </div>
      )}
    </div>
  )
}

// ── home detail ────────────────────────────────────────────────────────────

function Section({ title, children, titleColor }) {
  return (
    <div className="blueprint" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Corners />
      <div style={{
        fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
        fontFamily: 'var(--font-heading)', fontWeight: 600,
        color: titleColor || 'color-mix(in srgb, var(--color-text) 55%, transparent)',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function HomeDetail({ home, onBack, onRepaired, toast, onInvite, onRemove, mobile }) {
  const [detail, setDetail] = useState({ users: null, phones: null, backup: null, cpu: null })
  const v = home.vitals || {}
  const silent = home.level === 'down'

  useEffect(() => {
    let cancelled = false
    const id = home.home_id
    const set = (patch) => { if (!cancelled) setDetail(d => ({ ...d, ...patch })) }
    relayGetHome(id).then(h => set({ users: h?.users || [] })).catch(() => set({ users: [] }))
    relayHomeMobileDevices(id).then(r => set({ phones: r?.devices || r?.rows || [] })).catch(() => set({ phones: [] }))
    relayHomeBackupStatus(id).then(b => set({ backup: b })).catch(() => set({ backup: {} }))
    // 24 h of 5-minute samples. Trimmed to the most recent 24 for the bars so
    // each column is roughly an hour.
    relayHomeTelemetry(id, 288).then(r => set({ cpu: r?.rows || [] })).catch(() => set({ cpu: [] }))
    return () => { cancelled = true }
  }, [home.home_id])

  const bars = useMemo(() => {
    const rows = detail.cpu
    if (!rows) return null
    const sorted = rows.slice().reverse()      // oldest → newest
    const buckets = 24
    const size = Math.max(1, Math.ceil(sorted.length / buckets))
    const out = []
    for (let i = 0; i < sorted.length; i += size) {
      const chunk = sorted.slice(i, i + size)
      const vals = chunk.map(r => {
        const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
        return p?.cpu_pct
      }).filter(x => typeof x === 'number')
      out.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null)
    }
    return out.slice(-buckets)
  }, [detail.cpu])

  const tagStyle = home.level === 'down' ? { background: 'var(--down)', color: 'var(--color-bg)' }
    : home.level === 'degraded' ? { background: 'var(--warn-100)', color: 'var(--warn-800)', border: '1px solid var(--warn)' }
    : home.level === 'unknown' ? { border: '1px dashed var(--color-neutral-500)', color: 'var(--color-neutral-700)' }
    : { border: '1px solid var(--color-divider)', color: 'var(--color-neutral-700)' }

  const vitals = [
    ['Devices', v.devices_total == null ? '—' : (v.devices_offline ? `${v.devices_total - v.devices_offline} / ${v.devices_total}` : v.devices_total), v.devices_offline ? 'var(--warn-800)' : 'inherit'],
    ['Disk', v.disk_pct == null ? '—' : `${Math.round(v.disk_pct)}%`, v.disk_pct >= 85 ? 'var(--warn-800)' : 'inherit'],
    ['Memory', v.mem_pct == null ? '—' : `${Math.round(v.mem_pct)}%`, 'inherit'],
    ['CPU', v.cpu_pct == null ? '—' : `${Math.round(v.cpu_pct)}%`, 'inherit'],
    ['Uptime', fmtUptime(v.uptime_s), 'inherit'],
    ['Home Assistant', v.ha_version || '—', 'inherit'],
  ]

  const backup = detail.backup
  const backupText = backup == null ? 'Loading…'
    : backup.ts ? `Last backup ${clock(backup.ts)} · ${(backup.files || []).length} archives${backup.outcome && backup.outcome !== 'success' ? ` · ${backup.outcome}` : ''}`
    : 'No backup reported'
  const backupOk = backup?.outcome ? backup.outcome === 'success' : true

  return (
    <div style={{ padding: mobile ? '14px 16px 28px' : 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div><a href="#" onClick={(e) => { e.preventDefault(); onBack() }} style={{ fontSize: 13, textDecoration: 'none' }}>← Fleet</a></div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Mark sev={home.level} size={11} />
        <h3 style={{ margin: 0 }}>{home.name}</h3>
        <span style={{ ...tagStyle, fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10, letterSpacing: '.12em', padding: '3px 8px' }}>
          {STATE_WORD[home.level]}
        </span>
        <span style={{ fontSize: 13 }} className="text-muted">
          {home.owner_email || 'no owner'} · {shortRelease(v.release_tag) || 'unknown release'} · {v.cohort || 'no channel'}
        </span>
        <span style={home.subscription_state === 'active'
          ? { fontSize: 11, color: 'color-mix(in srgb, var(--color-text) 50%, transparent)' }
          : { background: 'var(--warn-100)', color: 'var(--warn-800)', border: '1px solid var(--warn)', fontSize: 10, fontWeight: 600, letterSpacing: '.1em', padding: '2px 8px' }}>
          {home.subscription_state === 'active' ? 'subscription active' : String(home.subscription_state || '').toUpperCase()}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          className="btn btn-secondary" style={{ fontSize: 13 }}
          onClick={async () => {
            try {
              const r = await relayOpenSupportSession(home.home_id, 'ops console')
              toast(r?.url ? `Support session opened — ${r.url}` : 'Support session opened')
            } catch (e) { toast(e?.userMessage || 'Could not open a support session') }
          }}
        >
          Support session
        </button>
      </div>

      {silent && (
        <div style={{ border: '1px solid var(--down)', background: 'var(--down-100)', padding: '10px 14px', fontSize: 13, color: 'var(--down-800)' }}>
          <strong>Silent for {fmtAgo(home.silent_for_s)}.</strong> Hubs report every 5 minutes and nothing has arrived.
          A silent hub is usually power or broadband at the house — telemetry can't tell you which. Vitals below are last-known.
        </div>
      )}

      {(home.issues || []).length > 0 && (
        <Section title="Issues">
          {home.issues.map((iss, i) => (
            <IssueRow key={i} issue={iss} homeId={home.home_id} disabled={silent}
              disabledNote="The hub can't hear us while it's silent." onDone={onRepaired} toast={toast} />
          ))}
          {silent && (
            <div style={{ fontSize: 11, borderTop: '1px solid var(--color-divider)', paddingTop: 8 }} className="text-muted">
              Repairs disabled — the hub can't hear us while it's silent.
            </div>
          )}
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(3,1fr)' : 'repeat(6,1fr)', gap: 12, opacity: silent ? .5 : 1 }}>
        {vitals.map(([label, value, color]) => (
          <div key={label}>
            <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }} className="text-muted">{label}</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 18, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3,1fr)', gap: mobile ? 12 : 18 }}>
        <Section title="CPU · last 24 h">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 44 }}>
            {(bars || Array.from({ length: 24 })).map((val, i) => (
              <span key={i} style={{
                width: 7,
                height: val == null ? 1 : Math.max(2, Math.round((val / 100) * 44)),
                background: val == null ? 'var(--color-neutral-300)' : 'var(--color-accent-400)',
              }} />
            ))}
          </div>
          <div style={{ fontSize: 11 }} className="text-muted">
            {bars == null ? 'Loading telemetry…'
              : bars.every(b => b == null) ? 'No samples — missing bars are missing data, drawn as absence.'
              : 'Averaged from 5-minute telemetry samples.'}
          </div>
        </Section>

        <Section title="Backups">
          <div style={{ fontSize: 13, color: backupOk ? 'inherit' : 'var(--warn-800)' }}>{backupText}</div>
          <div style={{ fontSize: 11 }} className="text-muted">
            {backup?.uploaded_bytes ? `${(backup.uploaded_bytes / 1048576).toFixed(1)} MB uploaded. ` : ''}
            Nightly, encrypted, to Backblaze.
          </div>
        </Section>

        <Section title="Updates">
          <div style={{ fontSize: 13 }}>Running <strong>{shortRelease(v.release_tag) || '—'}</strong></div>
          <div style={{ display: 'inline-flex', border: '1px solid var(--color-divider)', alignSelf: 'flex-start', opacity: .55 }}>
            {['production', 'canary'].map(c => (
              <span key={c} style={{
                padding: '5px 12px', fontSize: 12,
                background: v.cohort === c ? 'var(--color-accent)' : 'transparent',
                color: v.cohort === c ? 'var(--color-bg)' : 'var(--color-text)',
              }}>{c}</span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: v.drifted ? 'var(--warn-800)' : 'color-mix(in srgb, var(--color-text) 55%, transparent)' }}>
            {v.drifted ? 'Off channel — not receiving fixes.'
              : v.cohort === 'canary' ? 'Canary — deliberately ahead of the fleet.'
              : 'On channel. Updates itself within minutes of a release.'}
          </div>
          <div style={{ fontSize: 11 }} className="text-muted">
            Read-only: the channel is set on the hub itself (/etc/ziggy/ziggy.env), which the cloud cannot write.
          </div>
        </Section>

        <Section title="Paired phones">
          {detail.phones == null && <div style={{ fontSize: 12 }} className="text-muted">Loading…</div>}
          {detail.phones?.length === 0 && <div style={{ fontSize: 12 }} className="text-muted">No phones paired.</div>}
          {(detail.phones || []).map((p, i) => (
            <div key={i} style={{ display: 'flex', fontSize: 13, gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.device_name || p.name || p.device_id || 'device'}
              </span>
              <span className="text-muted" style={{ fontSize: 12 }}>{p.platform || p.push_provider || ''}</span>
            </div>
          ))}
        </Section>

        <Section title={<>Users</>}>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: -26, marginBottom: 4 }}>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onInvite}>+ Invite</button>
          </div>
          {detail.users == null && <div style={{ fontSize: 12 }} className="text-muted">Loading…</div>}
          {detail.users?.length === 0 && <div style={{ fontSize: 12 }} className="text-muted">No users yet.</div>}
          {(detail.users || []).map((u, i) => (
            <div key={i} style={{ display: 'flex', fontSize: 13, gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
              <span className="tag tag-neutral" style={{ fontSize: 10 }}>{u.role}</span>
            </div>
          ))}
        </Section>

        <Section title="Danger zone" titleColor="var(--down-800)">
          <div style={{ fontSize: 12 }} className="text-muted">
            Deprovisioning removes the home record and revokes the hub's relay key. The hub keeps working locally.
          </div>
          <div>
            <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--down-800)', borderColor: 'var(--down)' }} onClick={onRemove}>
              Deprovision home…
            </button>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── console ────────────────────────────────────────────────────────────────

export default function FleetOps({ onExit }) {
  const [report, setReport] = useState(null)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')
  const [needsAuth, setNeedsAuth] = useState(false)
  const [relayHost, setRelayHost] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastOk, setLastOk] = useState(null)
  const [view, setView] = useState('fleet')
  const [homeId, setHomeId] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState({})
  const [dialog, setDialog] = useState(null)
  const [toastMsg, setToastMsg] = useState('')
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 760)
  const [creds, setCreds] = useState({ email: '', password: '' })
  const [form, setForm] = useState({ name: '', email: '', role: 'Owner' })
  const [busy, setBusy] = useState(false)
  const toastTimer = useRef(null)

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 4200)
  }, [])

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 760)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!isRelayConfigured()) {
        const cfg = await getOpsRelayConfig().catch(() => null)
        const url = cfg?.data?.relay_url
        if (url) { setRelayUrl(url); setRelayHost(url) }
      }
      if (!isRelayConfigured()) {
        setError('This hub has no relay configured, so there is no fleet to show.')
        return
      }
      const [health, acts] = await Promise.all([
        relayFleetHealth(),
        relayFleetActivity(40).catch(() => ({ activity: [] })),
      ])
      setReport(health); setActivity(acts?.activity || [])
      setLastOk(new Date()); setError(''); setNeedsAuth(false)
    } catch (e) {
      const unauthorized = e?.status === 401 || e?.status === 403
        || e?.code === 'NOT_AUTHENTICATED' || e?.code === 'INSUFFICIENT_PERMISSIONS'
      if (unauthorized) setNeedsAuth(true)
      else setError(e?.userMessage || e?.message || 'Cloud relay unreachable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (!needsAuth) load() }, 60_000)
    return () => clearInterval(id)
  }, [load, needsAuth])

  const homes = report?.homes || []
  const counts = report?.summary?.counts || {}
  const current = homes.find(h => h.home_id === homeId) || null

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = homes.filter(h => !h.suspended)
    if (q) list = list.filter(h => (h.name || '').toLowerCase().includes(q) || (h.owner_email || '').toLowerCase().includes(q))
    if (filter === 'prob') list = list.filter(h => h.level === 'down' || h.level === 'degraded')
    if (filter === 'behind') list = list.filter(h => h.vitals?.drifted)
    // A broken home is always first; ties break on staleness.
    return list.slice().sort((a, b) =>
      (SEV_RANK[a.level] - SEV_RANK[b.level]) || ((b.silent_for_s || 0) - (a.silent_for_s || 0)))
  }, [homes, query, filter])

  const eventGroups = useMemo(() => {
    const groups = []
    for (const row of activity || []) {
      const label = dayLabel(row.ts)
      let g = groups.find(x => x.label === label)
      if (!g) { g = { label, items: [] }; groups.push(g) }
      g.items.push(row)
    }
    return groups
  }, [activity])

  const signIn = async (e) => {
    e?.preventDefault?.()
    setBusy(true)
    try {
      const res = await relayLogin(creds)
      if (!res?.token) throw new Error(res?.detail || "That email and password didn't work.")
      setRelayToken(res.token)
      window.location.reload()
    } catch (err) {
      toast(err?.message || "That email and password didn't work.")
      setBusy(false)
    }
  }

  const confirmDialog = async () => {
    setBusy(true)
    try {
      if (dialog === 'add') {
        if (!form.email.trim()) throw new Error('An owner email is required.')
        await relayCreateInvite({ type: 'home', email: form.email.trim(), role: 'admin',
          home_name: form.name.trim() || undefined, public_url: window.location.origin })
        toast(`Invite sent to ${form.email.trim()} — the home appears once its hub reports in.`)
      } else if (dialog === 'invite' && current) {
        if (!form.email.trim()) throw new Error('An email is required.')
        await relayCreateInvite({ type: 'user', email: form.email.trim(),
          role: form.role === 'Owner' ? 'admin' : 'user', home_id: current.home_id,
          public_url: window.location.origin })
        toast(`Invite sent to ${form.email.trim()}`)
      } else if (dialog === 'remove' && current) {
        await relayDeprovision(current.home_id)
        toast(`${current.name} deprovisioned — relay key revoked`)
        setView('fleet'); setHomeId(null)
      }
      setDialog(null); setForm({ name: '', email: '', role: 'Owner' })
      load()
    } catch (e) {
      toast(e?.userMessage || e?.message || "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  // ── signed out ───────────────────────────────────────────────────────────
  if (needsAuth) {
    return (
      <div className="zg-ops" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <form onSubmit={signIn} className="blueprint" style={{ width: 'min(360px,100%)', padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Corners />
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 18, letterSpacing: '.14em' }}>
            ZIGGY <span style={{ color: 'var(--color-accent)' }}>OPS</span>
          </div>
          <div style={{ fontSize: 13 }} className="text-muted">Operations console. Sign in with your Ziggy staff account.</div>
          <div className="field">
            <label>Email</label>
            <input className="input" autoComplete="username" value={creds.email}
              onChange={e => setCreds(c => ({ ...c, email: e.target.value }))} placeholder="you@ziggy.dev" />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" autoComplete="current-password" value={creds.password}
              onChange={e => setCreds(c => ({ ...c, password: e.target.value }))} placeholder="••••••••" />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div style={{ fontSize: 12 }} className="text-muted">No fleet data is shown before sign-in — not even counts.</div>
        </form>
      </div>
    )
  }

  const stale = error && lastOk
  const allHealthy = homes.length > 0 && !counts.down && !counts.degraded && !counts.unknown && !error

  return (
    <div className="zg-ops" style={{ border: '1px solid var(--color-divider)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '11px 20px', borderBottom: '1px solid var(--color-divider)' }}>
        <button
          onClick={onExit} disabled={!onExit}
          title={onExit ? 'Back to the admin console' : undefined}
          style={{
            fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 16,
            letterSpacing: '.14em', whiteSpace: 'nowrap', background: 'none',
            border: 'none', padding: 0, color: 'inherit',
            cursor: onExit ? 'pointer' : 'default',
          }}
        >
          ZIGGY <span style={{ color: 'var(--color-accent)' }}>OPS</span>
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['fleet', 'Fleet'], ['events', 'Events']].map(([k, label]) => {
            const on = k === 'events' ? view === 'events' : view !== 'events'
            return (
              <button key={k} onClick={() => { setView(k); if (k === 'fleet') setHomeId(null) }}
                style={{
                  background: 'none', border: 'none', borderBottom: on ? '2px solid var(--color-accent)' : '2px solid transparent',
                  color: on ? 'var(--color-accent)' : 'inherit', fontFamily: 'var(--font-body)',
                  fontSize: 14, fontWeight: on ? 600 : 400, cursor: 'pointer', padding: '4px 8px',
                }}>
                {label}
              </button>
            )
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, whiteSpace: 'nowrap' }} className="text-muted">
          <Mark sev={error ? 'down' : 'acc'} size={7} />
          {error ? 'Relay unreachable' : `Relay connected · swept ${lastOk ? clock(lastOk.toISOString()) : '—'}`}
        </div>
      </div>

      {/* stale-data banner */}
      {stale && (
        <div style={{ margin: '16px 20px 0', border: '1px solid var(--down)', background: 'var(--down-100)', padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Mark sev="down" size={10} />
          <span style={{ fontSize: 13, color: 'var(--down-800)' }}>
            <strong>Cloud relay unreachable since {clock(lastOk.toISOString())}.</strong>{' '}
            Everything below is last-known data — homes may have changed state since.
          </span>
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 10px', marginLeft: 'auto' }} onClick={load}>Retry</button>
        </div>
      )}
      {error && !lastOk && (
        <div style={{ padding: 20, fontSize: 13, color: 'var(--down-800)' }}>{error}</div>
      )}

      {/* loading skeleton — rows appear in place, the layout never jumps */}
      {loading && !report && !error && (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div className="zg-skel" style={{ width: 90, height: 24 }} />
            <div className="zg-skel" style={{ width: 200, height: 14 }} />
          </div>
          {[1, 2, 3, 4, 5].map(k => (
            <div key={k} className="zg-skel" style={{ height: 38, borderBottom: '1px solid var(--color-divider)' }} />
          ))}
          <div style={{ fontSize: 12 }} className="text-muted">Contacting relay…</div>
        </div>
      )}

      {/* fleet */}
      {report && view === 'fleet' && !current && (
        <div style={{ padding: mobile ? '14px 16px 28px' : 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {homes.length === 0 ? (
            <div style={{ minHeight: '40vh', display: 'grid', placeItems: 'center' }}>
              <div className="blueprint" style={{ width: 'min(420px,100%)', padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Corners />
                <h3 style={{ margin: 0 }}>No homes yet</h3>
                <p style={{ fontSize: 13, margin: 0 }} className="text-muted">
                  Create the first home record, invite its owner, and the hub will appear here as
                  {' '}<span style={{ whiteSpace: 'nowrap' }}>"unknown — waiting for first report"</span> until it phones in.
                </p>
                <div><button className="btn btn-primary" onClick={() => setDialog('add')}>Add a home</button></div>
              </div>
            </div>
          ) : (
            <>
              {allHealthy && (
                <div className="blueprint" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Corners />
                  <Mark sev="ok" size={10} />
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 16 }}>
                    All {homes.length} homes healthy
                  </span>
                  <span style={{ fontSize: 13 }} className="text-muted">
                    {report.versions?.converged
                      ? `stable ${shortRelease(report.versions.majority)}${Object.keys(report.versions.ahead || {}).length ? ' · canary ahead as intended' : ''}`
                      : 'versions split — see Release column'}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>
                  Fleet <span style={{ fontSize: 15, fontWeight: 400 }} className="text-muted">
                    {homes.length} {homes.length === 1 ? 'home' : 'homes'}
                  </span>
                </h3>
                {[['down', 'down', 'var(--down-800)', 700], ['degraded', 'degraded', 'var(--warn-800)', 400],
                  ['unknown', 'unknown', 'color-mix(in srgb, var(--color-text) 55%, transparent)', 400],
                  ['ok', 'healthy', 'color-mix(in srgb, var(--color-text) 55%, transparent)', 400]]
                  .filter(([k]) => counts[k])
                  .map(([k, label, color, weight]) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color, fontWeight: weight }}>
                      <Mark sev={k} /> {counts[k]} {label}
                    </span>
                  ))}
                <span style={{ marginLeft: 'auto' }} />
                <input className="input" style={{ width: 220 }} placeholder="Search homes or owners…"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <div style={{ display: 'inline-flex', border: '1px solid var(--color-divider)' }}>
                  {[['all', 'All'], ['prob', 'Problems'], ['behind', 'Behind']].map(([k, label]) => (
                    <button key={k} onClick={() => setFilter(k)} style={{
                      padding: '6px 12px', fontSize: 13, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                      background: filter === k ? 'var(--color-accent)' : 'transparent',
                      color: filter === k ? 'var(--color-bg)' : 'var(--color-text)',
                    }}>{label}</button>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={() => setDialog('add')}>Add home</button>
              </div>

              {!mobile && (
                <div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '6px 8px',
                    fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
                    color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
                    borderBottom: '1px solid var(--color-divider)',
                  }}>
                    <span>State</span><span>Home</span><span>Last report</span><span>Issues</span>
                    <span>Devices</span><span>Disk</span><span>Release</span><span />
                  </div>
                  {rows.map(h => (
                    <FleetRow key={h.home_id} home={h} expanded={!!expanded[h.home_id]}
                      onToggle={() => setExpanded(x => ({ ...x, [h.home_id]: !x[h.home_id] }))}
                      onOpen={() => { setHomeId(h.home_id); setView('home') }}
                      onRepaired={load} toast={toast} />
                  ))}
                </div>
              )}

              {mobile && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {rows.map(h => (
                    <div key={h.home_id} onClick={() => { setHomeId(h.home_id); setView('home') }}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 4px', cursor: 'pointer',
                        borderBottom: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                        background: h.level === 'down' ? 'var(--down-100)' : 'transparent',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Mark sev={h.level} />
                        <strong style={{ flex: 1, fontSize: 15 }}>{h.name}</strong>
                        <span style={{ fontSize: 12 }} className="text-muted">{STATE_WORD[h.level]}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, fontSize: 12, paddingLeft: 19 }}>
                        <span className="text-muted">{fmtAgo(h.silent_for_s)}</span>
                        <span className="text-muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(h.issues || [])[0]?.message || 'All good.'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {rows.length === 0 && (
                <div style={{ padding: 24, fontSize: 13, textAlign: 'center' }} className="text-muted">
                  {query ? `No homes match "${query}".` : 'No homes match this filter.'}
                </div>
              )}
              <div style={{ fontSize: 11 }} className="text-muted">
                Sorted by severity, then staleness — a broken home is always first.
                "Behind" answers "is everyone on the release?"
              </div>
            </>
          )}
        </div>
      )}

      {/* events */}
      {report && view === 'events' && (
        <div style={{ padding: mobile ? '14px 16px 28px' : 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ margin: 0 }}>Events</h3>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13, maxWidth: 760 }}>
            {eventGroups.length === 0 && (
              <span style={{ fontSize: 12 }} className="text-muted">
                Nothing yet. Updates, automatic repairs and new homes show up here.
              </span>
            )}
            {eventGroups.map(g => (
              <div key={g.label}>
                <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', padding: '14px 0 6px' }} className="text-muted">
                  {g.label}
                </div>
                {g.items.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)' }}>
                    <span style={{ width: 42, flex: 'none' }} className="text-muted">{clock(e.ts)}</span>
                    <Mark sev={e.ok === 0 ? 'down' : e.event === 'home_version_changed' ? 'acc' : 'ok'} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <strong>{eventSubject(e)}</strong> {eventText(e)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* home detail */}
      {report && view === 'home' && current && (
        <HomeDetail
          home={current} mobile={mobile}
          onBack={() => { setView('fleet'); setHomeId(null) }}
          onRepaired={load} toast={toast}
          onInvite={() => setDialog('invite')}
          onRemove={() => setDialog('remove')}
        />
      )}

      {/* dialogs */}
      {dialog && (
        <div className="zg-ops-backdrop" onClick={() => setDialog(null)}>
          <div className="zg-ops-dialog zg-ops" onClick={e => e.stopPropagation()}>
            <div className="dialog-title">
              {dialog === 'add' ? 'Add a home' : dialog === 'invite' ? 'Invite a user' : `Deprovision ${current?.name || ''}`}
            </div>
            {dialog === 'remove' && (
              <div className="dialog-body">
                This removes <strong>{current?.name}</strong> from the fleet and revokes its relay key.
                The owner keeps local control of their home. This cannot be undone from here.
              </div>
            )}
            {(dialog === 'add' || dialog === 'invite') && (
              <>
                {dialog === 'add' && (
                  <div className="field">
                    <label>Home name</label>
                    <input className="input" placeholder="e.g. Birchwood" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                )}
                <div className="field">
                  <label>Owner email</label>
                  <input className="input" placeholder="owner@example.com" value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: 14 }}>
                  {['Owner', 'Member'].map(r => (
                    <label key={r} className="radio">
                      <input type="radio" name="zg-role" checked={form.role === r}
                        onChange={() => setForm(f => ({ ...f, role: r }))} />
                      <span className="dot" />{r}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}
                style={dialog === 'remove' ? { background: 'var(--down)', borderColor: 'var(--down)' } : undefined}
                onClick={confirmDialog}>
                {busy ? 'Working…' : dialog === 'add' ? 'Create & invite' : dialog === 'invite' ? 'Send invite' : 'Deprovision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 70,
          background: 'var(--color-neutral-900)', color: 'var(--color-bg)', padding: '9px 16px',
          fontSize: 13, boxShadow: 'var(--shadow-md)', maxWidth: '80vw',
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  )
}

// ── event copy ─────────────────────────────────────────────────────────────

function eventSubject(row) {
  if (row.name) return row.name
  if (row.event === 'fleet_home_deleted' && row.detail) {
    try { const s = JSON.parse(row.detail); if (s?.name) return s.name } catch { /* not JSON */ }
  }
  return row.home_id || 'Fleet'
}

function eventText(row) {
  const d = row.detail || ''
  switch (row.event) {
    case 'home_version_changed':   return `updated — ${d}`
    case 'fleet_auto_repair':      return `auto-repair · ${d}`
    case 'fleet_home_deleted':     return 'deprovisioned — relay key revoked'
    case 'register_hub':           return 'registered with the relay'
    case 'home_provisioned':       return 'provisioned'
    case 'support_session_opened': return 'support session opened'
    case 'backup_restored':        return 'backup restored'
    case 'home_hostname_set':      return `address updated — ${d}`
    default:                       return `${row.event}${d ? ` — ${d}` : ''}`
  }
}
