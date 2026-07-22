// People & Permissions — the consumer surface over the policy engine (PDP).
//
// Lists household members, lets an owner set each person's Access Level (a preset
// role that compiles to grants server-side), and provides a live "Try a command"
// panel that calls /permissions/authorize/explain so you can watch the real
// allow/deny + obligations + reasoning for any (person, action, device, channel).
//
// This is intentionally a thin client: every decision is the backend engine's,
// never re-implemented here. Enforcement on real device commands is separately
// gated by features.permission_enforcement (off | shadow | enforce).
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getPermissionsOverview, permissionsExplain, bindPermissionRole,
  bootstrapPermissions, getPermissionAudit,
} from '../lib/api'

const PRESET_LABEL = {
  owner: 'Owner', admin: 'Admin', adult: 'Adult', teen: 'Teen', kid: 'Kid', guest: 'Guest',
}
const AVATARS = ['👩', '🧑', '🧑‍🎤', '🧒', '👵', '👨', '🧓', '👧']
const ACTION_LABEL = {
  'light.onoff': 'Turn on / off', 'light.brightness': 'Dim', 'media.playback': 'Play / pause',
  'climate.setpoint': 'Set temperature', 'lock.lock': 'Lock', 'lock.unlock': 'Unlock',
  'camera.live': 'View live', 'alarm.disarm': 'Disarm alarm', 'cover.open': 'Open', 'cover.close': 'Close',
}
const OB_LABEL = {
  step_up: '🔐 Step-up', notify: '🔔 Notify', two_person: '👥 Two-person',
  record_reason: '📝 Record reason', log_verbose: '📋 Audit log', undo_window: '↩ Undo window',
}
const CLASS_ICON = {
  light: '💡', media: '📺', climate: '🌡', lock: '🔒', camera: '📷',
  alarm: '🛡', garage: '🚪', sensor: '📡', switch: '🔌',
}

const card = {
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16,
  boxShadow: 'var(--shadow, 0 1px 2px rgba(0,0,0,.05))',
}
const eyebrow = {
  fontSize: 10.5, fontWeight: 660, letterSpacing: '.08em', textTransform: 'uppercase',
  color: 'var(--ink-faint)',
}

function capsForClass(cls, allCaps) {
  const byCls = { light: ['light.onoff', 'light.brightness'], media: ['media.playback'],
    climate: ['climate.setpoint'], lock: ['lock.unlock', 'lock.lock'], camera: ['camera.live'],
    alarm: ['alarm.disarm'], garage: ['cover.open', 'cover.close'], sensor: ['sensor.read'] }
  const guess = byCls[cls]
  if (guess) return guess.filter(k => allCaps.includes(k) || true)
  return allCaps.filter(k => k.startsWith(cls + '.'))
}

export default function People() {
  const [ov, setOv] = useState(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState(false)

  const [forbidden, setForbidden] = useState(false)
  const load = () => getPermissionsOverview()
    .then(d => { setOv(d); if (!sel && d.people?.length) setSel(d.people[0].ref) })
    .catch(e => {
      if (e?.status === 403) { setForbidden(true); return }
      setErr(e?.message || 'Could not load permissions.')
    })

  useEffect(() => { load() }, []) // eslint-disable-line

  if (forbidden) return (
    <Shell>
      <div style={{ ...card, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 30 }}>🔒</div>
        <h3 style={{ margin: '10px 0 4px' }}>Admins only</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: 0 }}>
          Managing people and permissions is limited to the home’s owner and admins.</p>
      </div>
    </Shell>
  )

  const person = useMemo(() => ov?.people.find(p => p.ref === sel) || null, [ov, sel])

  async function setPreset(role) {
    if (!person) return
    setBusy(true)
    try {
      await bindPermissionRole({
        binding_id: `ui:${person.name}`, principal: person.ref,
        scope: 'space:home', role,
      })
      await load()
    } catch (e) { setErr(e?.message || 'Could not update access.') }
    finally { setBusy(false) }
  }

  if (err) return (
    <Shell>
      <div style={{ ...card, padding: 20 }}>
        <p style={{ margin: 0, color: 'var(--ink)' }}>{err}</p>
        <button onClick={() => { setErr(''); bootstrapPermissions().then(load).catch(e => setErr(e.message)) }}
          style={btn}>Set up the permission model</button>
      </div>
    </Shell>
  )
  if (!ov) return <Shell><Skeleton /></Shell>

  if (!ov.people.length) return (
    <Shell>
      <div style={{ ...card, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 30 }}>🔐</div>
        <h3 style={{ margin: '10px 0 4px' }}>No people yet</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: 0 }}>
          Import your household + devices into the permission model to get started.</p>
        <button onClick={() => { setBusy(true); bootstrapPermissions().then(load).finally(() => setBusy(false)) }}
          disabled={busy} style={btn}>{busy ? 'Setting up…' : 'Set up now'}</button>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18,
        alignItems: 'start' }} className="perm-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={card}>
            <Head title="People" sub="tap to select" />
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {ov.people.map((p, i) => (
                  <PersonCard key={p.ref} p={p} i={i} selected={p.ref === sel}
                    onClick={() => setSel(p.ref)} />
                ))}
              </div>
            </div>
          </div>

          {person && (
            <div style={card}>
              <Head title={`${person.name}’s access`} sub={person.role ? PRESET_LABEL[person.role] : 'no role'} />
              <div style={{ padding: 16 }}>
                <div style={{ ...eyebrow, marginBottom: 7 }}>Access level</div>
                <Segmented options={ov.presets} value={person.role} disabled={busy}
                  onChange={setPreset} labels={PRESET_LABEL} />
                <div style={{ ...eyebrow, margin: '18px 0 8px' }}>
                  What {person.name} can do — live from the engine
                </div>
                <CapabilityMatrix person={person} ov={ov} />
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'sticky', top: 14, display: 'flex', flexDirection: 'column', gap: 18 }}
          className="perm-right">
          {person && <Playground person={person} ov={ov} />}
          <AuditStrip />
        </div>
      </div>
      <style>{`@media(max-width:900px){.perm-grid{grid-template-columns:1fr!important}.perm-right{position:static!important}}`}</style>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: '-.02em' }}>People &amp; Permissions</h1>
        <p style={{ margin: '3px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
          Set what each person can control. Every decision below is computed by the policy engine.</p>
      </div>
      {children}
    </div>
  )
}

function Head({ title, sub }) {
  return (
    <div style={{ padding: '14px 16px 11px', borderBottom: '1px solid var(--line-soft, var(--line))',
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 640 }}>{title}</h2>
      <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{sub}</span>
    </div>
  )
}

function PersonCard({ p, i, selected, onClick }) {
  const age = p.attrs?.age
  return (
    <button onClick={onClick} style={{
      flex: 'none', width: 104, textAlign: 'center', cursor: 'pointer',
      border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
      background: selected ? 'var(--accent-soft, var(--surface-2))' : 'var(--surface-2, var(--surface))',
      borderRadius: 12, padding: '12px 10px', transition: '.15s',
    }}>
      <div style={{ fontSize: 26, lineHeight: 1, marginBottom: 6 }}>{AVATARS[i % AVATARS.length]}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis' }}>{p.name}</div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 1 }}>
        {p.role ? PRESET_LABEL[p.role] : '—'}{age != null ? ` · ${age}` : ''}</div>
    </button>
  )
}

function Segmented({ options, value, onChange, labels, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2, var(--ground))',
      border: '1px solid var(--line)', borderRadius: 11, padding: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o === value
        return (
          <button key={o} disabled={disabled} onClick={() => onChange(o)} style={{
            flex: '1 1 auto', border: 0, borderRadius: 8, padding: '7px 6px', fontSize: 12,
            fontWeight: 560, cursor: disabled ? 'wait' : 'pointer',
            background: on ? 'var(--surface)' : 'transparent',
            color: on ? 'var(--ink)' : 'var(--ink-soft)',
            boxShadow: on ? 'var(--shadow, 0 1px 2px rgba(0,0,0,.06))' : 'none',
          }}>{labels[o] || o}</button>
        )
      })}
    </div>
  )
}

function CapabilityMatrix({ person, ov }) {
  const checks = [
    { ico: '💡', label: 'Everyday devices (lights, media)', action: 'light.onoff', clsPick: 'light' },
    { ico: '🌡', label: 'Thermostat', action: 'climate.setpoint', clsPick: 'climate' },
    { ico: '🔒', label: 'Unlock the front door', action: 'lock.unlock', clsPick: 'lock' },
    { ico: '📷', label: 'View cameras', action: 'camera.live', clsPick: 'camera' },
  ]
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true
    async function run() {
      const out = []
      for (const c of checks) {
        const dev = ov.devices.find(d => d.class === c.clsPick)
        if (!dev) { out.push({ ...c, state: 'n/a' }); continue }
        try {
          const r = await permissionsExplain({
            subject: person.ref, action: c.action, resource: dev.ref,
            context: { session: { channel: 'app', trust_level: 3 } },
          })
          out.push({ ...c, state: r.allowed ? 'yes' : 'no' })
        } catch { out.push({ ...c, state: 'no' }) }
      }
      if (live) setRows(out)
    }
    run()
    return () => { live = false }
  }, [person.ref, person.role]) // eslint-disable-line

  if (!rows) return <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>Checking…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center',
            background: 'var(--surface-2, var(--ground))', fontSize: 14 }}>{r.ico}</span>
          <span style={{ flex: 1 }}>{r.label}</span>
          <Pill state={r.state} />
        </div>
      ))}
    </div>
  )
}

function Pill({ state }) {
  const map = {
    yes: ['CAN', 'var(--ok, #0f9d6a)', 'var(--ok-soft, #e2f5ec)'],
    no: ['NO', 'var(--accent-strong, #dc4b52)', 'var(--danger-soft, #fbe7e8)'],
    'n/a': ['—', 'var(--ink-faint)', 'var(--surface-2, var(--ground))'],
  }
  const [t, c, bg] = map[state] || map['n/a']
  return <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 700,
    padding: '2px 8px', borderRadius: 6, color: c, background: bg }}>{t}</span>
}

function Playground({ person, ov }) {
  const [device, setDevice] = useState(ov.devices[0]?.ref || '')
  const [channel, setChannel] = useState('app')
  const dev = ov.devices.find(d => d.ref === device)
  const actions = dev ? capsForClass(dev.class, ov.capabilities) : []
  const [action, setAction] = useState(actions[0] || '')
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (!actions.includes(action)) setAction(actions[0] || '') }, [device]) // eslint-disable-line

  useEffect(() => {
    if (!device || !action) return
    let live = true
    setLoading(true)
    const trust = { app: 3, voice: 1, face: 3, nfc: 2 }[channel]
    permissionsExplain({
      subject: person.ref, action, resource: device,
      context: { session: { channel, trust_level: trust } },
    }).then(r => { if (live) setRes(r) }).catch(() => live && setRes(null))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [person.ref, person.role, device, action, channel])

  return (
    <div style={card}>
      <Head title="Try a command" sub={`as ${person.name}`} />
      <div style={{ padding: 16 }}>
        <Field label="Device">
          <select value={device} onChange={e => setDevice(e.target.value)} style={selectStyle}>
            {ov.devices.map(d => (
              <option key={d.ref} value={d.ref}>
                {(CLASS_ICON[d.class] || '•') + ' ' + d.name}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <Field label="Action">
            <select value={action} onChange={e => setAction(e.target.value)} style={selectStyle}>
              {actions.map(a => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
            </select>
          </Field>
          <Field label="Channel">
            <select value={channel} onChange={e => setChannel(e.target.value)} style={selectStyle}>
              <option value="app">📱 App</option>
              <option value="voice">🎙 Voice</option>
              <option value="face">☺ Face ID</option>
              <option value="nfc">📶 NFC</option>
            </select>
          </Field>
        </div>
        <Decision res={res} loading={loading} channel={channel} />
      </div>
    </div>
  )
}

function Decision({ res, loading, channel }) {
  if (loading && !res) return <div style={{ ...decBox('n'), marginTop: 4 }}>Evaluating…</div>
  if (!res) return null
  const allowed = res.allowed
  const trust = { app: 3, voice: 1, face: 3, nfc: 2 }[channel]
  return (
    <AnimatePresence mode="wait">
      <motion.div key={allowed + res.reason} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }} style={{ ...decBox(allowed ? 'y' : 'x'), marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
            color: '#fff', background: allowed ? 'var(--ok, #0f9d6a)' : 'var(--accent-strong, #dc4b52)' }}>
            {allowed ? '✓' : '✕'}</span>
          <span style={{ fontSize: 20, fontWeight: 720,
            color: allowed ? 'var(--ok, #0f9d6a)' : 'var(--accent-strong, #dc4b52)' }}>
            {allowed ? 'ALLOWED' : 'DENIED'}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>{res.reason}</div>
        {res.obligations?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
            {res.obligations.map((o, i) => {
              const need = o.params?.min_trust
              const unmet = o.kind === 'step_up' && need != null && trust < need
              return (
                <span key={i} style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 600,
                  border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 7,
                  padding: '3px 8px', color: unmet ? 'var(--warn, #c8871a)' : 'var(--ink)' }}>
                  {OB_LABEL[o.kind] || o.kind}
                  {need != null ? ` ≥${need}` : ''}
                  {o.params?.targets ? ` ${o.params.targets.join(', ')}` : ''}
                  {unmet ? ' — needs Face ID' : ''}
                </span>
              )
            })}
          </div>
        )}
        {res.trace?.length > 0 && (
          <details style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 9 }}>
            <summary style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)', cursor: 'pointer' }}>
              How Ziggy decided ({res.trace.length})</summary>
            <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, lineHeight: 1.7,
              marginTop: 8, color: 'var(--ink-soft)' }}>
              {res.trace.map((t, i) => (
                <div key={i}>{t.stage === 'combine'
                  ? `└─ ${t.result}`
                  : `• ${t.grant || ''} ${t.note || t.result || ''}`}</div>
              ))}
            </div>
          </details>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

function AuditStrip() {
  const [rows, setRows] = useState(null)
  useEffect(() => { getPermissionAudit({ limit: 6 }).then(d => setRows(d.events || [])).catch(() => setRows([])) }, [])
  if (!rows || !rows.length) return null
  return (
    <div style={card}>
      <Head title="Recent decisions" sub="attributed" />
      <div style={{ padding: '10px 16px 14px' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5,
            padding: '5px 0', borderTop: i ? '1px solid var(--line-soft, var(--line))' : 'none' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none',
              background: r.effect === 'allow' ? 'var(--ok, #0f9d6a)' : 'var(--accent-strong, #dc4b52)' }} />
            <span style={{ color: 'var(--ink)', fontWeight: 550 }}>{(r.subject || '').split(':')[1]}</span>
            <span style={{ fontFamily: 'var(--mono, monospace)', color: 'var(--ink-soft)' }}>{r.action}</span>
            <span style={{ color: 'var(--ink-faint)', marginLeft: 'auto',
              fontFamily: 'var(--mono, monospace)' }}>{(r.resource || '').split(':')[1]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', ...eyebrow, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const selectStyle = {
  width: '100%', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)',
  background: 'var(--surface-2, var(--ground))', border: '1px solid var(--line)',
  borderRadius: 10, padding: '9px 11px',
}
const btn = {
  marginTop: 14, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff',
  borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
function decBox(kind) {
  const c = kind === 'y' ? 'var(--ok, #0f9d6a)' : kind === 'x' ? 'var(--accent-strong, #dc4b52)' : 'var(--line)'
  return {
    border: `1.5px solid color-mix(in srgb, ${c} 35%, transparent)`, borderRadius: 14, padding: 16,
    background: `color-mix(in srgb, ${c} 8%, var(--surface))`,
  }
}
function Skeleton() {
  return <div style={{ ...card, padding: 24, color: 'var(--ink-faint)', fontSize: 13 }}>Loading household…</div>
}
