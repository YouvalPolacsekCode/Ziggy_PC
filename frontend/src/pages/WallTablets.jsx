// Settings → Wall tablets.
//
// Admin surface for the wall dashboard: pair a new tablet, see which panels
// are alive, and decide what each one is allowed to do.
//
// The capability model matters more here than anywhere else in Ziggy, because
// a wall tablet is the one screen in the home that is shared, always unlocked,
// and reachable by children and visitors. So this page is deliberately blunt:
// a row of switches, and a PIN that gates the dangerous ones.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listWallTablets, mintWallPairCode, patchWallTablet, removeWallTablet,
  putWallPolicy, setWallPin,
} from '../lib/api'
import { useT } from '../lib/i18n'

const CAPS = [
  { key: 'lights',      label: 'Lights',           hint: 'Turn lights on/off and dim them' },
  { key: 'climate',     label: 'Heating & cooling', hint: 'Change AC and heater setpoints' },
  { key: 'media',       label: 'Media',            hint: 'Play, pause and skip' },
  { key: 'scenes',      label: 'Scenes',           hint: 'Run on-demand actions' },
  { key: 'lists',       label: 'Lists & agenda',   hint: 'Shopping list and reminders' },
  { key: 'automations', label: 'Automations',      hint: 'View and switch automations on/off' },
  { key: 'cameras',     label: 'Cameras',          hint: 'See camera feeds on the wall' },
  { key: 'locks',       label: 'Locks',            hint: 'Lock and unlock doors' },
  { key: 'devices',     label: 'Devices & pairing', hint: 'Open the device list and pair new hardware' },
  { key: 'settings',    label: 'Settings',         hint: 'Change hub settings from the wall' },
]

function relTime(ts) {
  if (!ts) return '—'
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 90) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`
  return `${Math.floor(secs / 86400)} d ago`
}

const card = {
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 14, padding: 16, marginBottom: 12,
}

function Switch({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 42, height: 26, borderRadius: 999, border: 'none', flex: 'none',
        background: on ? 'var(--ok)' : 'var(--line-2)', position: 'relative',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'background .2s ease',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, insetInlineStart: on ? 19 : 3,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'inset-inline-start .2s ease', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </button>
  )
}

function TabletCard({ tablet, onChanged }) {
  const [policy, setPolicy] = useState(tablet.policy)
  const [saving, setSaving] = useState(false)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { setPolicy(tablet.policy) }, [tablet.policy])

  const save = useCallback(async (next) => {
    const prev = policy
    setPolicy(next)          // optimistic — a switch that lags feels broken
    setSaving(true)
    try {
      const res = await putWallPolicy(tablet.id, next)
      setPolicy(res.policy)
    } catch (e) {
      setPolicy(prev)
      setMsg(e?.userMessage || 'Could not save.')
    } finally { setSaving(false) }
  }, [policy, tablet.id])

  const toggleCap = (key, on) =>
    save({ ...policy, capabilities: { ...policy.capabilities, [key]: on } })

  const togglePinReq = (key, on) => save({
    ...policy,
    pin_required: on
      ? [...new Set([...policy.pin_required, key])]
      : policy.pin_required.filter((k) => k !== key),
  })

  const savePin = useCallback(async () => {
    setMsg('')
    try {
      const res = await setWallPin(tablet.id, pin || null)
      setPolicy(res.policy)
      setPin('')
      setMsg(res.policy.has_pin ? 'PIN set.' : 'PIN cleared.')
    } catch (e) { setMsg(e?.userMessage || 'Could not set the PIN.') }
  }, [tablet.id, pin])

  const unpair = useCallback(async () => {
    if (!window.confirm(`Un-pair "${tablet.display_name}"? Its layout and PIN are deleted.`)) return
    try { await removeWallTablet(tablet.id); onChanged() }
    catch (e) { setMsg(e?.userMessage || 'Could not un-pair.') }
  }, [tablet, onChanged])

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{tablet.display_name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
            {tablet.room ? `${tablet.room} · ` : ''}last seen {relTime(tablet.last_seen)}
          </div>
        </div>
        <button
          onClick={unpair}
          style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 999,
                   padding: '6px 14px', fontSize: 12, color: 'var(--err)', cursor: 'pointer' }}
        >Un-pair</button>
      </div>

      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase',
                    color: 'var(--ink-faint)', fontWeight: 600, marginBottom: 8 }}>
        What this tablet may do
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {CAPS.map((c) => {
          const on = policy?.capabilities?.[c.key] !== false
          const pinned = policy?.pin_required?.includes(c.key)
          return (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                                      borderBottom: '0.5px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{c.hint}</div>
              </div>
              {on && (
                <button
                  type="button"
                  onClick={() => togglePinReq(c.key, !pinned)}
                  title="Require the PIN for this"
                  style={{
                    background: pinned ? 'var(--accent)' : 'transparent',
                    color: pinned ? 'var(--on-accent)' : 'var(--ink-faint)',
                    border: '0.5px solid var(--line)', borderRadius: 999,
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                  }}
                >PIN</button>
              )}
              <Switch on={on} disabled={saving} onChange={(v) => toggleCap(c.key, v)} />
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          value={pin}
          inputMode="numeric"
          maxLength={8}
          placeholder={policy?.has_pin ? 'Change PIN (4–8 digits)' : 'Set a PIN (4–8 digits)'}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          style={{ padding: '9px 12px', borderRadius: 10, border: '0.5px solid var(--line)',
                   background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, flex: 1, minWidth: 180 }}
        />
        <button
          onClick={savePin}
          style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
                   borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >{pin ? 'Save PIN' : 'Clear PIN'}</button>
        {policy?.has_pin && <span style={{ fontSize: 11.5, color: 'var(--ok)' }}>PIN is set</span>}
      </div>
      {msg && <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 8 }}>{msg}</div>}
    </div>
  )
}

export default function WallTablets() {
  const t = useT()
  const [tablets, setTablets] = useState([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listWallTablets()
      .then((r) => setTablets(r?.tablets || []))
      .catch((e) => setError(e?.userMessage || 'Could not load tablets.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Codes expire after 5 minutes; count it down so nobody walks to the wall
  // with a code that died on the way.
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!code) return
    const id = setInterval(() => {
      const s = Math.max(0, Math.floor(code.expires_at - Date.now() / 1000))
      setLeft(s)
      if (s === 0) setCode(null)
    }, 1000)
    return () => clearInterval(id)
  }, [code])

  const mint = useCallback(async () => {
    setError('')
    try {
      const res = await mintWallPairCode('')
      setCode(res)
      setLeft(res.ttl_s || 300)
    } catch (e) { setError(e?.userMessage || 'Could not create a code.') }
  }, [])

  return (
    <div style={{ padding: '18px 16px 60px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 4px' }}>Wall tablets</h1>
      <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: '0 0 18px' }}>
        Tablets that show the wall dashboard at <code>/wall</code>. Each one keeps its own
        layout and its own set of permissions.
      </p>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Pair a new tablet</div>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 12px' }}>
          Open <code>/wall</code> on the tablet, tap “Pair tablet”, and enter this code.
        </p>
        {code ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 8,
                          fontFamily: "'IBM Plex Mono', monospace" }}>{code.code}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
              expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </div>
          </div>
        ) : (
          <button
            onClick={mint}
            style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
                     borderRadius: 999, padding: '10px 20px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >Generate a code</button>
        )}
      </div>

      {error && <div style={{ color: 'var(--err)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Loading…</p>
      ) : tablets.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>No tablets paired yet.</p>
      ) : (
        tablets.map((tb) => <TabletCard key={tb.id} tablet={tb} onChanged={load} />)
      )}
    </div>
  )
}
