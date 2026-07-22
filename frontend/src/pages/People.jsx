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
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getPermissionsOverview, permissionsExplain, bindPermissionRole,
  bootstrapPermissions, getPermissionAudit, getPrincipalGrants,
  issuePermissionGrant, revokePermissionGrant,
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

// Frontend safety net: NEVER show a raw entity_id. Humanize anything that looks
// like one (contains a dot) or is missing a proper name.
function humanizeId(raw) {
  if (!raw) return ''
  const obj = raw.includes('.') ? raw.split('.').slice(1).join('.') : raw
  return obj.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || raw
}
function deviceName(d) {
  const n = d && d.name
  if (n && !n.includes('.')) return n            // already a friendly name
  return humanizeId(n || (d && d.id) || '')
}
function resourceName(ref) {
  return humanizeId((ref || '').split(':').slice(1).join(':'))
}
// Room keys lose the apostrophe ("roni's room" → "roni_s_room"). Restore the
// possessive so the header reads "Roni's Room" (CSS capitalize handles case),
// not "Roni S Room".
function humanizeRoom(key) {
  return (key || 'home')
    .replace(/_s_/g, "'s ")
    .replace(/_s$/, "'s")
    .replace(/_/g, ' ')
    .trim()
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
  const [version, setVersion] = useState(0)   // bump to re-evaluate live panels
  const bump = () => setVersion(v => v + 1)

  const [forbidden, setForbidden] = useState(false)
  const load = () => getPermissionsOverview()
    .then(d => { setOv(d); if (!sel && d.people?.length) setSel(d.people[0].ref) })
    .catch(e => {
      if (e?.status === 403) { setForbidden(true); return }
      setErr(e?.message || 'Could not load permissions.')
    })

  useEffect(() => { load() }, []) // eslint-disable-line

  // Access-level is a PENDING selection until saved — the person card keeps
  // showing the saved role; changing the segmented control only stages a change
  // that a Save button commits. Reset whenever the selected person (or data)
  // changes. (Kept above the early returns to respect the rules of hooks.)
  const [pendingRole, setPendingRole] = useState(null)
  useEffect(() => {
    const p = ov?.people?.find(x => x.ref === sel)
    setPendingRole(p?.role ?? null)
  }, [sel, ov])

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

  async function saveRole() {
    if (!person || !pendingRole || pendingRole === person.role) return
    setBusy(true)
    try {
      await bindPermissionRole({
        binding_id: `ui:${person.name}`, principal: person.ref,
        scope: 'space:home', role: pendingRole,
      })
      await load()   // reload → person.role updates → effect clears the dirty state
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
      <div className="perm-grid">
        <div className="perm-col" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                <Segmented options={ov.presets} value={pendingRole} disabled={busy}
                  onChange={setPendingRole} labels={PRESET_LABEL} />
                {pendingRole && pendingRole !== person.role && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                    <button onClick={saveRole} disabled={busy} style={savePill}>
                      {busy ? 'Saving…' : 'Save'}</button>
                    <button onClick={() => setPendingRole(person.role)} disabled={busy}
                      style={linkBtn}>Cancel</button>
                  </div>
                )}
                {person.role === 'kid' && (
                  <KidAccess person={person} ov={ov} onChange={bump} />
                )}
                <div style={{ ...eyebrow, margin: '18px 0 8px' }}>
                  What {person.name} can do — live from the engine
                </div>
                <CapabilityMatrix person={person} ov={ov} version={version} />
              </div>
            </div>
          )}
        </div>

        <div className="perm-col perm-right" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {person && <Playground person={person} ov={ov} version={version} />}
          <AuditStrip />
        </div>
      </div>
      <style>{`
        /* Mobile-first: single column by default so the page can never overflow
           the viewport; upgrade to two columns only when there's room. */
        .perm-grid{display:flex;flex-direction:column;gap:18px;width:100%}
        .perm-grid>.perm-col{min-width:0;max-width:100%}
        .perm-grid select,.perm-grid input{max-width:100%}
        @media(min-width:920px){
          .perm-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
          .perm-right{position:sticky;top:14px}
        }
        /* Very narrow phones: stack the paired Playground controls too. */
        @media(max-width:420px){ .perm-two{grid-template-columns:1fr!important} }
        /* Collapsible per-room device groups on the kid screen. */
        .kid-room{border-top:1px solid var(--line-soft,var(--line))}
        .kid-room>summary{list-style:none;cursor:pointer;display:flex;align-items:center;
          justify-content:space-between;gap:10px;padding:11px 2px}
        .kid-room>summary::-webkit-details-marker{display:none}
        .kid-room>summary .chev{transition:transform .15s;color:var(--ink-faint);font-size:11px;flex:none}
        .kid-room[open]>summary .chev{transform:rotate(90deg)}
      `}</style>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 16px 60px',
      width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
      <Link to="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12.5, color: 'var(--ink-soft)', textDecoration: 'none', marginBottom: 10 }}>
        <ChevronLeft size={13} /> Settings
      </Link>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: '-.02em' }}>People &amp; Access</h1>
          <p style={{ margin: '3px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
            Set what each person can control. Every decision below is computed by the policy engine.</p>
        </div>
        <Link to="/settings/users" style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--accent)',
          textDecoration: 'none', whiteSpace: 'nowrap' }}>Manage login accounts →</Link>
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

// ── Kid one-screen: per-device allowlist + allowed hours ────────────────────
// A kid is default-deny; each enabled device becomes an explicit allow grant
// with a deterministic id (kidallow:<user>:<deviceId>) carrying an optional
// time-window condition. Security-class devices are never offerable (the kid
// role denies them anyway) — matching "hide dangerous controls".
const KID_CAP = { any_of: [{ scope_tag: 'lighting' }, { scope_tag: 'media' }, { scope_tag: 'climate' }] }
const DANGEROUS = new Set(['lock', 'camera', 'alarm', 'garage'])
// The user-facing device *tiles* — what the Devices page shows. Excludes the
// read-only sub-entities (temperature/energy/occupancy/illuminance/…) that a
// physical device also exposes; you don't grant a kid "access" to a sensor.
const CONTROLLABLE = new Set(['light', 'switch', 'media', 'climate', 'lock',
  'camera', 'garage', 'cover', 'fan', 'alarm'])

function kidGrantId(person, dev) { return `kidallow:${person.name}:${dev.id}` }

function KidAccess({ person, ov, onChange }) {
  const [grants, setGrants] = useState(null)
  const [hoursOn, setHoursOn] = useState(false)
  const [from, setFrom] = useState('07:00')
  const [to, setTo] = useState('20:00')
  const [saving, setSaving] = useState('')

  const load = () => getPrincipalGrants(person.ref).then(d => {
    const gs = d.grants || []
    setGrants(gs)
    // Derive the allowed-hours window from any existing kid allow grant.
    const withCond = gs.find(g => g.id.startsWith(`kidallow:${person.name}:`) && g.condition)
    if (withCond?.condition?.between) {
      setHoursOn(true); setFrom(withCond.condition.between[1]); setTo(withCond.condition.between[2])
    } else { setHoursOn(false) }
  }).catch(() => setGrants([]))

  useEffect(() => { load() }, [person.ref]) // eslint-disable-line

  const enabled = useMemo(() => {
    const s = new Set()
    for (const g of grants || []) {
      const pre = `kidallow:${person.name}:`
      if (g.id.startsWith(pre) && g.effect === 'allow') s.add(g.id.slice(pre.length))
    }
    return s
  }, [grants, person.name])

  function conditionNow() {
    return hoursOn ? { between: [{ var: 'time.local' }, from, to] } : null
  }

  async function toggleDevice(dev) {
    const id = kidGrantId(person, dev)
    setSaving(dev.id)
    try {
      if (enabled.has(dev.id)) {
        await revokePermissionGrant(id)
      } else {
        await issuePermissionGrant({
          id, principal: person.ref, effect: 'allow',
          resource: { resource: dev.ref }, capability: KID_CAP, condition: conditionNow(),
        })
      }
      await load(); onChange && onChange()
    } finally { setSaving('') }
  }

  async function applyHours(nextOn, nextFrom, nextTo) {
    setHoursOn(nextOn); if (nextFrom) setFrom(nextFrom); if (nextTo) setTo(nextTo)
    const cond = nextOn ? { between: [{ var: 'time.local' }, nextFrom || from, nextTo || to] } : null
    setSaving('hours')
    try {
      // Re-issue every enabled device grant with the new window (same id ⇒ overwrite).
      for (const dev of ov.devices) {
        if (!enabled.has(dev.id)) continue
        await issuePermissionGrant({
          id: kidGrantId(person, dev), principal: person.ref, effect: 'allow',
          resource: { resource: dev.ref }, capability: KID_CAP, condition: cond,
        })
      }
      await load(); onChange && onChange()
    } finally { setSaving('') }
  }

  if (grants === null) return <div style={{ color: 'var(--ink-faint)', fontSize: 12, marginTop: 12 }}>Loading…</div>

  // Real HA area names from the overview (fall back to the humanized slug).
  const spaceName = {}
  for (const s of ov.spaces || []) { if (s.name) spaceName[s.id] = s.name }
  const roomLabel = (key) => spaceName[key] || humanizeRoom(key)

  // Only the real controllable device tiles — not the sub-entity sensors.
  const tiles = ov.devices.filter(d => CONTROLLABLE.has(d.class))
  const rooms = {}
  for (const d of tiles) { (rooms[d.space_id || 'home'] ||= []).push(d) }
  const roomEntries = Object.entries(rooms).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div>
      <div style={{ ...eyebrow, margin: '18px 0 6px' }}>Devices {person.name} can use</div>
      {roomEntries.length === 0 && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>No controllable devices in this home.</div>
      )}
      {roomEntries.map(([room, devs]) => {
        const onCount = devs.filter(d => enabled.has(d.id)).length
        return (
          <details key={room} className="kid-room">
            <summary>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className="chev">▸</span>
                <span style={{ textTransform: 'capitalize', fontWeight: 550, fontSize: 13,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {roomLabel(room)}</span>
              </span>
              <span style={{ fontSize: 11.5, color: onCount ? 'var(--accent)' : 'var(--ink-faint)',
                flex: 'none', fontWeight: 550 }}>{onCount}/{devs.length} on</span>
            </summary>
            <div style={{ paddingBottom: 6 }}>
              {devs.map(d => {
                const danger = DANGEROUS.has(d.class)
                const on = enabled.has(d.id)
                return (
                  <div key={d.ref} style={rowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap' }}>{(CLASS_ICON[d.class] || '•') + ' ' + deviceName(d)}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                        {danger ? 'Dangerous — kids can’t be given this' : d.class}</div>
                    </div>
                    <Toggle on={on} locked={danger} busy={saving === d.id}
                      onClick={() => !danger && toggleDevice(d)} />
                  </div>
                )
              })}
            </div>
          </details>
        )
      })}

      <div style={{ ...eyebrow, margin: '18px 0 6px' }}>Allowed hours</div>
      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 13 }}>Only during set hours</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
            Outside this window, {person.name}’s controls are blocked</div>
        </div>
        <Toggle on={hoursOn} busy={saving === 'hours'}
          onClick={() => applyHours(!hoursOn, from, to)} />
      </div>
      {hoursOn && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
          <input type="time" value={from} onChange={e => applyHours(true, e.target.value, to)}
            style={timeInput} />
          <span style={{ color: 'var(--ink-faint)', fontSize: 12 }}>to</span>
          <input type="time" value={to} onChange={e => applyHours(true, from, e.target.value)}
            style={timeInput} />
        </div>
      )}
    </div>
  )
}

const rowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '9px 0', borderTop: '1px solid var(--line-soft, var(--line))',
}
const timeInput = {
  fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', background: 'var(--surface-2, var(--ground))',
  border: '1px solid var(--line)', borderRadius: 9, padding: '6px 9px',
}

function Toggle({ on, locked, busy, onClick }) {
  return (
    <button onClick={onClick} disabled={locked || busy} aria-pressed={!!on} style={{
      width: 42, height: 25, borderRadius: 99, border: 0, position: 'relative', flex: 'none',
      cursor: locked ? 'not-allowed' : busy ? 'wait' : 'pointer', padding: 0, transition: '.2s',
      opacity: busy ? 0.6 : 1,
      background: locked ? 'var(--danger-soft, #fbe7e8)' : on ? 'var(--accent)' : 'var(--line)',
    }}>
      <span style={{
        position: 'absolute', top: 2.5, width: 20, height: 20, borderRadius: '50%',
        left: on ? 19.5 : 2.5, transition: '.2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        background: locked ? 'var(--accent-strong, #dc4b52)' : '#fff',
      }} />
    </button>
  )
}

function CapabilityMatrix({ person, ov, version }) {
  // Only offer checks for capabilities this home actually has — no thermostat
  // device ⇒ no "Thermostat" row, etc. Each check picks the first present
  // device of its class(es) and is evaluated against that real device.
  const CHECKS = [
    { ico: '💡', label: 'Lights', action: 'light.onoff', classes: ['light', 'switch'] },
    { ico: '📺', label: 'Media & TV', action: 'media.playback', classes: ['media'] },
    { ico: '🌡', label: 'Thermostat', action: 'climate.setpoint', classes: ['climate'] },
    { ico: '🔒', label: 'Unlock the front door', action: 'lock.unlock', classes: ['lock'] },
    { ico: '🚪', label: 'Garage', action: 'cover.open', classes: ['garage'] },
    { ico: '🛡', label: 'Disarm the alarm', action: 'alarm.disarm', classes: ['alarm'] },
    { ico: '📷', label: 'View cameras', action: 'camera.live', classes: ['camera'] },
  ]
  const present = useMemo(() => CHECKS
    .map(c => ({ ...c, dev: ov.devices.find(d => c.classes.includes(d.class)) }))
    .filter(c => c.dev), [ov.devices]) // eslint-disable-line

  const [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true
    async function run() {
      const out = []
      for (const c of present) {
        try {
          const r = await permissionsExplain({
            subject: person.ref, action: c.action, resource: c.dev.ref,
            context: { session: { channel: 'app', trust_level: 3 } },
          })
          out.push({ ...c, state: r.allowed ? 'yes' : 'no' })
        } catch { out.push({ ...c, state: 'no' }) }
      }
      if (live) setRows(out)
    }
    run()
    return () => { live = false }
  }, [person.ref, person.role, version]) // eslint-disable-line

  if (!rows) return <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>Checking…</div>
  if (!rows.length) return (
    <div style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>
      No controllable devices in this home yet.</div>
  )
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

function Playground({ person, ov, version }) {
  // Only real device tiles, not sub-entity sensors.
  const tiles = useMemo(() => ov.devices.filter(d => CONTROLLABLE.has(d.class)), [ov.devices])
  const [device, setDevice] = useState(tiles[0]?.ref || '')
  const [channel, setChannel] = useState('app')
  const dev = tiles.find(d => d.ref === device)
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
  }, [person.ref, person.role, device, action, channel, version])

  return (
    <div style={card}>
      <Head title="Try a command" sub={`as ${person.name}`} />
      <div style={{ padding: 16 }}>
        <Field label="Device">
          <select value={device} onChange={e => setDevice(e.target.value)} style={selectStyle}>
            {tiles.map(d => (
              <option key={d.ref} value={d.ref}>
                {(CLASS_ICON[d.class] || '•') + ' ' + deviceName(d)}
              </option>
            ))}
          </select>
        </Field>
        <div className="perm-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
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
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8,
          overflowWrap: 'anywhere' }}>{res.reason}</div>
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
              marginTop: 8, color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
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
            <span style={{ color: 'var(--ink-faint)', marginLeft: 'auto' }}>{resourceName(r.resource)}</span>
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
const savePill = {
  border: 0, background: 'var(--accent)', color: '#fff', borderRadius: 999,
  padding: '6px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
}
const linkBtn = {
  border: 0, background: 'transparent', color: 'var(--ink-soft)', fontSize: 12.5,
  fontWeight: 500, cursor: 'pointer', padding: '6px 4px',
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
