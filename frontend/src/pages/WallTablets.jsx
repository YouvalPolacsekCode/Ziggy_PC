// Settings → Wall tablets.
//
// Admin surface for the wall dashboard: pair a new tablet, see which panels
// are alive, and decide what each one is allowed to do.
//
// The capability model matters more here than anywhere else in Ziggy, because
// a wall tablet is the one screen in the home that is shared, always unlocked,
// and reachable by children and visitors. So this page is deliberately blunt:
// a row of switches, and a PIN that gates the dangerous ones.

import { useCallback, useEffect, useState } from 'react'
import {
  listWallTablets, mintWallPairCode, patchWallTablet, removeWallTablet,
  putWallPolicy, setWallPin,
} from '../lib/api'
import { useT } from '../lib/i18n'
import { Toggle } from '../components/ui/Toggle'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'

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
  borderRadius: 'var(--r-card)', padding: 16, marginBottom: 12,
}

// Active-filter chip: surface-2 fill + ink + hairline. Never inverted, never
// accent — the PIN gate is a state, not the screen's primary action.
function chipStyle(on) {
  return {
    minHeight: 44, padding: '0 16px', borderRadius: 999,
    background: on ? 'var(--surface-2)' : 'transparent',
    color: on ? 'var(--ink)' : 'var(--ink-mute)',
    border: '0.5px solid var(--line)',
    fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
    transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
  }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>{tablet.display_name}</div>
          <div style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 2 }}>
            {tablet.room ? `${tablet.room} · ` : ''}last seen {relTime(tablet.last_seen)}
          </div>
        </div>
        <Button variant="danger" onClick={unpair}>Un-pair</Button>
      </div>

      <p className="z-eyebrow" style={{ marginBottom: 8 }}>What this tablet may do</p>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {CAPS.map((c) => {
          const on = policy?.capabilities?.[c.key] !== false
          const pinned = policy?.pin_required?.includes(c.key)
          return (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 0',
                                      borderBottom: '0.5px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{c.label}</div>
                <div style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 2 }}>{c.hint}</div>
              </div>
              {on && (
                <button
                  type="button"
                  onClick={() => togglePinReq(c.key, !pinned)}
                  title="Require the PIN for this"
                  aria-pressed={!!pinned}
                  style={chipStyle(pinned)}
                >PIN</button>
              )}
              <Toggle checked={on} disabled={saving} onCheckedChange={(v) => toggleCap(c.key, v)} aria-label={c.label} />
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Input
            value={pin}
            inputMode="numeric"
            maxLength={8}
            dir="ltr"
            placeholder={policy?.has_pin ? 'Change PIN (4–8 digits)' : 'Set a PIN (4–8 digits)'}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <button onClick={savePin} className="z-btn-secondary">{pin ? 'Save PIN' : 'Clear PIN'}</button>
        {policy?.has_pin && <span style={{ fontSize: 15, color: 'var(--ok-text)' }}>PIN is set</span>}
      </div>
      {msg && <div style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 8 }}>{msg}</div>}
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
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div className="z-page-head">
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>Wall tablets</h1>
          <p className="z-subhead" style={{ marginTop: 4 }}>
            Tablets that show the wall dashboard at <span className="z-code">/wall</span>. Each one keeps its own
            layout and its own set of permissions.
          </p>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 17, color: 'var(--ink)', marginBottom: 4 }}>Pair a new tablet</div>
        <p style={{ fontSize: 15, color: 'var(--ink-mute)', margin: '0 0 12px' }}>
          Open <span className="z-code">/wall</span> on the tablet, tap “Pair tablet”, and enter this code.
        </p>
        {code ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div className="z-code" style={{ fontSize: 34, fontWeight: 700, lineHeight: '41px', color: 'var(--ink)' }}>{code.code}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>
              expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </div>
          </div>
        ) : (
          <button onClick={mint} className="z-btn-primary">Generate a code</button>
        )}
      </div>

      {error && <div style={{ color: 'var(--err-text)', fontSize: 15, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <p style={{ fontSize: 15, color: 'var(--ink-mute)' }}>Loading…</p>
      ) : tablets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: 17, color: 'var(--ink)' }}>No tablets paired yet.</p>
          <p style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 4 }}>Generate a code above and enter it on the tablet.</p>
        </div>
      ) : (
        tablets.map((tb) => <TabletCard key={tb.id} tablet={tb} onChanged={load} />)
      )}
    </div>
  )
}
