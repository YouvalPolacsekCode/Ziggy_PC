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
import {
  ArrowLeft, ChevronRight, ChevronDown, Lock, CheckCircle2, XCircle,
  Lightbulb, Tv, Thermometer, Camera, Shield, DoorOpen, Radio, Plug, Circle,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getPermissionsOverview, permissionsExplain, bindPermissionRole,
  bootstrapPermissions, getPermissionAudit, getPrincipalGrants,
  issuePermissionGrant, revokePermissionGrant,
} from '../lib/api'
import { Toggle } from '../components/ui/Toggle'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { T_ENTER } from '../lib/motion'

const PRESET_LABEL = {
  owner: 'Owner', admin: 'Admin', adult: 'Adult', teen: 'Teen', kid: 'Kid', guest: 'Guest',
}
// Person avatars are content (a face for a household member), not UI glyphs,
// so they stay emoji.
const AVATARS = ['👩', '🧑', '🧑‍🎤', '🧒', '👵', '👨', '🧓', '👧']
const ACTION_LABEL = {
  'light.onoff': 'Turn on / off', 'light.brightness': 'Dim', 'media.playback': 'Play / pause',
  'climate.setpoint': 'Set temperature', 'lock.lock': 'Lock', 'lock.unlock': 'Unlock',
  'camera.live': 'View live', 'alarm.disarm': 'Disarm alarm', 'cover.open': 'Open', 'cover.close': 'Close',
}
const OB_LABEL = {
  step_up: 'Step-up', notify: 'Notify', two_person: 'Two-person',
  record_reason: 'Record reason', log_verbose: 'Audit log', undo_window: 'Undo window',
}
// Device-class glyphs: line icons only.
const CLASS_ICON = {
  light: Lightbulb, media: Tv, climate: Thermometer, lock: Lock, camera: Camera,
  alarm: Shield, garage: DoorOpen, sensor: Radio, switch: Plug,
}
function ClassIcon({ cls, size = 20 }) {
  const Icon = CLASS_ICON[cls] || Circle
  return <Icon size={size} strokeWidth={1.75} style={{ flexShrink: 0 }} />
}

const card = {
  background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-card)',
}

// Borderless 44-tall text button in ink — for the quiet actions (Cancel,
// "Manage login accounts").
const ghostBtn = {
  minHeight: 44, padding: '0 12px', borderRadius: 'var(--r-ctl)', border: 0, background: 'transparent',
  color: 'var(--ink)', fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 4,
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
// Scrub any embedded entity refs from the (technical) decision trace so a raw
// entity_id can't surface even there. Only rewrites real device-domain tokens,
// leaving capability keys / grant ids intact.
const _ENTITY_RE = /\b(?:light|switch|lock|camera|climate|sensor|binary_sensor|media_player|cover|fan|alarm_control_panel)\.[a-z0-9_x]+/gi
function humanizeTrace(line) {
  return String(line)
    .replace(/device:([^\s]+)/g, (_m, id) => humanizeId(id))
    .replace(/space:([^\s]+)/g, (_m, id) => humanizeId(id))
    .replace(_ENTITY_RE, (m) => humanizeId(m))
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
      <div style={{ ...card, padding: 32, textAlign: 'center' }}>
        <Lock size={32} strokeWidth={1.75} style={{ color: 'var(--ink-mute)' }} />
        <h3 style={{ margin: '12px 0 4px', fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Admins only</h3>
        <p style={{ color: 'var(--ink-mute)', fontSize: 15, margin: 0 }}>
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
      <div style={{ ...card, padding: 32, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>{err}</p>
        <button onClick={() => { setErr(''); bootstrapPermissions().then(load).catch(e => setErr(e.message)) }}
          className="z-btn-secondary" style={{ marginTop: 16 }}>Set up the permission model</button>
      </div>
    </Shell>
  )
  if (!ov) return <Shell><Skeleton /></Shell>

  if (!ov.people.length) return (
    <Shell>
      <div style={{ ...card, padding: 32, textAlign: 'center' }}>
        <Lock size={32} strokeWidth={1.75} style={{ color: 'var(--ink-mute)' }} />
        <h3 style={{ margin: '12px 0 4px', fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>No people yet</h3>
        <p style={{ color: 'var(--ink-mute)', fontSize: 15, margin: 0 }}>
          Import your household + devices into the permission model to get started.</p>
        <button onClick={() => { setBusy(true); bootstrapPermissions().then(load).finally(() => setBusy(false)) }}
          disabled={busy} className="z-btn-secondary" style={{ marginTop: 16 }}>{busy ? 'Setting up…' : 'Set up now'}</button>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <div className="perm-grid">
        <div className="perm-col" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={card}>
            <Head title="People" sub="tap to select" />
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
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
                <p className="z-eyebrow" style={{ marginBottom: 8 }}>Access level</p>
                <Segmented options={ov.presets} value={pendingRole} disabled={busy}
                  onChange={setPendingRole} labels={PRESET_LABEL} />
                {pendingRole && pendingRole !== person.role && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
                    <button onClick={saveRole} disabled={busy} className="z-btn-primary">
                      {busy ? 'Saving…' : 'Save'}</button>
                    <button onClick={() => setPendingRole(person.role)} disabled={busy}
                      style={ghostBtn}>Cancel</button>
                  </div>
                )}
                {person.role === 'kid' && (
                  <KidAccess person={person} ov={ov} onChange={bump} />
                )}
                <p className="z-eyebrow" style={{ margin: '16px 0 8px' }}>
                  What {person.name} can do — live from the engine
                </p>
                <CapabilityMatrix person={person} ov={ov} version={version} />
              </div>
            </div>
          )}
        </div>

        <div className="perm-col perm-right" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {person && <Playground person={person} ov={ov} version={version} />}
          <AuditStrip />
        </div>
      </div>
      <style>{`
        /* Mobile-first: single column by default so the page can never overflow
           the viewport; upgrade to two columns only when there's room. */
        .perm-grid{display:flex;flex-direction:column;gap:16px;width:100%}
        .perm-grid>.perm-col{min-width:0;max-width:100%}
        .perm-grid select,.perm-grid input{max-width:100%}
        @media(min-width:920px){
          .perm-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
          .perm-right{position:sticky;top:16px}
        }
        /* Very narrow phones: stack the paired Playground controls too. */
        @media(max-width:420px){ .perm-two{grid-template-columns:1fr!important} }
        /* Collapsible per-room device groups on the kid screen. */
        .kid-room{border-top:0.5px solid var(--line)}
        .kid-room>summary{list-style:none;cursor:pointer;display:flex;align-items:center;
          justify-content:space-between;gap:12px;min-height:44px;padding:8px 0}
        .kid-room>summary::-webkit-details-marker{display:none}
        .kid-room>summary .chev{color:var(--ink-faint);flex:none;display:flex}
        .kid-room[open]>summary .chev-closed{display:none}
        .kid-room:not([open])>summary .chev-open{display:none}
      `}</style>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px',
      width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
      <Link to="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44,
        fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)', textDecoration: 'none', marginBottom: 8 }}>
        <ArrowLeft size={18} className="icon-flip-rtl" /> Settings
      </Link>
      <div className="z-page-head" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>People &amp; Access</h1>
          <p className="z-subhead" style={{ marginTop: 4 }}>
            Set what each person can control. Every decision below is computed by the policy engine.</p>
        </div>
        <Link to="/settings/users" className="z-link-quiet" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44,
          fontSize: 15, fontWeight: 500, color: 'var(--ink)', textDecoration: 'none', whiteSpace: 'nowrap', gap: 4 }}>
          Manage login accounts <ChevronRight size={18} className="icon-flip-rtl" />
        </Link>
      </div>
      <style>{`.z-link-quiet:hover{text-decoration:underline}`}</style>
      {children}
    </div>
  )
}

function Head({ title, sub }) {
  return (
    <div style={{ padding: '16px 16px 12px', borderBottom: '0.5px solid var(--line)',
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <h2 className="z-headline" style={{ margin: 0 }}>{title}</h2>
      <span style={{ fontSize: 15, color: 'var(--ink-mute)' }}>{sub}</span>
    </div>
  )
}

function PersonCard({ p, i, selected, onClick }) {
  const age = p.attrs?.age
  return (
    <button onClick={onClick} aria-pressed={selected} style={{
      flex: 'none', width: 112, textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
      border: `${selected ? '1.5px' : '0.5px'} solid ${selected ? 'var(--ink)' : 'var(--line)'}`,
      background: selected ? 'var(--surface-2)' : 'var(--surface)',
      borderRadius: 'var(--r-ctl)', padding: 12,
      transition: 'border-color var(--dur-press) var(--ease-standard), background var(--dur-press) var(--ease-standard)',
    }}>
      <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 8 }}>{AVATARS[i % AVATARS.length]}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis' }}>{p.name}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>
        {p.role ? PRESET_LABEL[p.role] : '—'}{age != null ? ` · ${age}` : ''}</div>
    </button>
  )
}

function Segmented({ options, value, onChange, labels, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)',
      border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', padding: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o === value
        return (
          <button key={o} disabled={disabled} onClick={() => onChange(o)} aria-pressed={on} style={{
            flex: '1 1 auto', border: 0, borderRadius: 'var(--r-chip)', minHeight: 44, padding: '0 8px', fontSize: 15,
            fontWeight: 600, cursor: disabled ? 'wait' : 'pointer', fontFamily: 'inherit',
            background: on ? 'var(--surface)' : 'transparent',
            color: on ? 'var(--ink)' : 'var(--ink-mute)',
            boxShadow: on ? 'var(--shadow-sm)' : 'none',
            transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
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

  if (grants === null) return <div style={{ color: 'var(--ink-mute)', fontSize: 15, marginTop: 12 }}>Loading…</div>

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
      <p className="z-eyebrow" style={{ margin: '16px 0 8px' }}>Devices {person.name} can use</p>
      {roomEntries.length === 0 && (
        <div style={{ color: 'var(--ink-mute)', fontSize: 15 }}>No controllable devices in this home.</div>
      )}
      {roomEntries.map(([room, devs]) => {
        const onCount = devs.filter(d => enabled.has(d.id)).length
        return (
          <details key={room} className="kid-room">
            <summary>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className="chev chev-closed"><ChevronRight size={18} className="icon-flip-rtl" /></span>
                <span className="chev chev-open"><ChevronDown size={18} /></span>
                <span style={{ textTransform: 'capitalize', fontWeight: 500, fontSize: 17, color: 'var(--ink)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {roomLabel(room)}</span>
              </span>
              <span style={{ fontSize: 15, color: onCount ? 'var(--ink)' : 'var(--ink-mute)',
                flex: 'none', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{onCount}/{devs.length} on</span>
            </summary>
            <div style={{ paddingBottom: 8 }}>
              {devs.map(d => {
                const danger = DANGEROUS.has(d.class)
                const on = enabled.has(d.id)
                return (
                  <div key={d.ref} style={rowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span style={{ color: 'var(--ink-mute)', display: 'flex' }}><ClassIcon cls={d.class} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 17, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap' }}>{deviceName(d)}</div>
                        <div style={{ fontSize: 15, color: 'var(--ink-mute)', textTransform: danger ? 'none' : 'capitalize' }}>
                          {danger ? 'Dangerous — kids can’t be given this' : d.class}</div>
                      </div>
                    </div>
                    <Toggle checked={on} disabled={danger || saving === d.id}
                      aria-label={deviceName(d)}
                      onCheckedChange={() => !danger && toggleDevice(d)} />
                  </div>
                )
              })}
            </div>
          </details>
        )
      })}

      <p className="z-eyebrow" style={{ margin: '16px 0 8px' }}>Allowed hours</p>
      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 17, color: 'var(--ink)' }}>Only during set hours</div>
          <div style={{ fontSize: 15, color: 'var(--ink-mute)' }}>
            Outside this window, {person.name}’s controls are blocked</div>
        </div>
        <Toggle checked={hoursOn} disabled={saving === 'hours'} aria-label="Only during set hours"
          onCheckedChange={() => applyHours(!hoursOn, from, to)} />
      </div>
      {hoursOn && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <Input type="time" value={from} onChange={e => applyHours(true, e.target.value, to)} aria-label="From" style={{ width: 140 }} />
          <span style={{ color: 'var(--ink-mute)', fontSize: 15 }}>to</span>
          <Input type="time" value={to} onChange={e => applyHours(true, from, e.target.value)} aria-label="To" style={{ width: 140 }} />
        </div>
      )}
    </div>
  )
}

const rowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  minHeight: 56, padding: '8px 0', borderTop: '0.5px solid var(--line)',
}

function CapabilityMatrix({ person, ov, version }) {
  // Only offer checks for capabilities this home actually has — no thermostat
  // device ⇒ no "Thermostat" row, etc. Each check picks the first present
  // device of its class(es) and is evaluated against that real device.
  const CHECKS = [
    { cls: 'light',  label: 'Lights', action: 'light.onoff', classes: ['light', 'switch'] },
    { cls: 'media',  label: 'Media & TV', action: 'media.playback', classes: ['media'] },
    { cls: 'climate', label: 'Thermostat', action: 'climate.setpoint', classes: ['climate'] },
    { cls: 'lock',   label: 'Unlock the front door', action: 'lock.unlock', classes: ['lock'] },
    { cls: 'garage', label: 'Garage', action: 'cover.open', classes: ['garage'] },
    { cls: 'alarm',  label: 'Disarm the alarm', action: 'alarm.disarm', classes: ['alarm'] },
    { cls: 'camera', label: 'View cameras', action: 'camera.live', classes: ['camera'] },
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

  if (!rows) return <div style={{ color: 'var(--ink-mute)', fontSize: 15 }}>Checking…</div>
  if (!rows.length) return (
    <div style={{ color: 'var(--ink-mute)', fontSize: 15 }}>
      No controllable devices in this home yet.</div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 17, minHeight: 44 }}>
          <span style={{ width: 36, height: 36, borderRadius: 'var(--r-ctl)', display: 'grid', placeItems: 'center',
            background: 'var(--surface-2)', color: 'var(--ink-mute)', flexShrink: 0 }}><ClassIcon cls={r.cls} /></span>
          <span style={{ flex: 1, color: 'var(--ink)' }}>{r.label}</span>
          <Pill state={r.state} />
        </div>
      ))}
    </div>
  )
}

function Pill({ state }) {
  const map = {
    yes: ['Can', 'var(--ok-text)'],
    no: ['No', 'var(--err-text)'],
    'n/a': ['—', 'var(--ink-mute)'],
  }
  const [t, c] = map[state] || map['n/a']
  return <span className="z-chip" style={{ color: c, fontWeight: 600 }}>{t}</span>
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
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select label="Device" value={device} onChange={e => setDevice(e.target.value)}
          style={{ width: '100%' }}
          options={tiles.map(d => ({ value: d.ref, label: deviceName(d) }))} />
        <div className="perm-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select label="Action" value={action} onChange={e => setAction(e.target.value)}
            style={{ width: '100%' }}
            options={actions.map(a => ({ value: a, label: ACTION_LABEL[a] || a }))} />
          <Select label="Channel" value={channel} onChange={e => setChannel(e.target.value)}
            style={{ width: '100%' }}
            options={[
              { value: 'app', label: 'App' },
              { value: 'voice', label: 'Voice' },
              { value: 'face', label: 'Face ID' },
              { value: 'nfc', label: 'NFC' },
            ]} />
        </div>
        <Decision res={res} loading={loading} channel={channel} />
      </div>
    </div>
  )
}

function Decision({ res, loading, channel }) {
  if (loading && !res) return <div style={{ ...decBox('n'), fontSize: 15, color: 'var(--ink-mute)' }}>Evaluating…</div>
  if (!res) return null
  const allowed = res.allowed
  const trust = { app: 3, voice: 1, face: 3, nfc: 2 }[channel]
  return (
    <AnimatePresence mode="wait">
      <motion.div key={allowed + res.reason} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        transition={T_ENTER} style={decBox(allowed ? 'y' : 'x')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {allowed
            ? <CheckCircle2 size={24} strokeWidth={1.75} style={{ color: 'var(--ok)', flexShrink: 0 }} />
            : <XCircle size={24} strokeWidth={1.75} style={{ color: 'var(--err)', flexShrink: 0 }} />}
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em',
            color: allowed ? 'var(--ok)' : 'var(--err)' }}>
            {allowed ? 'Allowed' : 'Denied'}</span>
        </div>
        <div style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 8,
          overflowWrap: 'anywhere' }}>{res.reason}</div>
        {res.obligations?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {res.obligations.map((o, i) => {
              const need = o.params?.min_trust
              const unmet = o.kind === 'step_up' && need != null && trust < need
              return (
                <span key={i} className="z-chip" style={{ color: unmet ? 'var(--warn-text)' : 'var(--ink-2)' }}>
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
          <details style={{ marginTop: 12, borderTop: '0.5px solid var(--line)' }}>
            <summary style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-mute)', cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
              How Ziggy decided ({res.trace.length})</summary>
            <div className="z-code" style={{ fontSize: 13, lineHeight: 1.7,
              color: 'var(--ink-mute)', overflowWrap: 'anywhere', direction: 'ltr', textAlign: 'start' }}>
              {res.trace.map((t, i) => (
                <div key={i}>{humanizeTrace(t.stage === 'combine'
                  ? `└─ ${t.result}`
                  : `• ${t.grant || ''} ${t.note || t.result || ''}`)}</div>
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
      <div style={{ padding: '0 16px 8px' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, minHeight: 44,
            padding: '4px 0', borderTop: i ? '0.5px solid var(--line)' : 'none' }}>
            <span className={`z-dot ${r.effect === 'allow' ? 'z-dot-ok' : 'z-dot-err'}`} style={{ flex: 'none' }} />
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{(r.subject || '').split(':')[1]}</span>
            <span className="z-code" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{r.action}</span>
            <span style={{ color: 'var(--ink-mute)', marginInlineStart: 'auto' }}>{resourceName(r.resource)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function decBox(kind) {
  const c = kind === 'y' ? 'var(--ok)' : kind === 'x' ? 'var(--err)' : 'var(--line)'
  return {
    border: `0.5px solid color-mix(in srgb, ${c} 35%, var(--line))`, borderRadius: 'var(--r-card)', padding: 16,
    background: `color-mix(in srgb, ${c} 8%, var(--surface))`,
  }
}
function Skeleton() {
  return <div style={{ ...card, padding: 32, color: 'var(--ink-mute)', fontSize: 15, textAlign: 'center' }}>Loading household…</div>
}
