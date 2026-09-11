import { useState, useEffect } from 'react'
import { getRooms } from '../../lib/api'
import { useDeviceStore } from '../../stores/deviceStore'
import { INTENT_PARAM_SCHEMA } from '../../lib/intentParamSchema'
import { useT } from '../../lib/i18n'

// Selectable chip. Active = surface-2 fill + ink text + hairline; never the
// brand accent (the form's primary action owns that). 44px tall so it is a
// real touch target even though it reads as a chip.
function chipStyle(active) {
  return {
    minHeight: 44, padding: '0 16px', borderRadius: 999,
    fontSize: 15, fontWeight: active ? 600 : 500, fontFamily: 'inherit',
    background: active ? 'var(--surface-2)' : 'var(--surface)',
    color: active ? 'var(--ink)' : 'var(--ink-mute)',
    border: `0.5px solid ${active ? 'var(--line-2)' : 'var(--line)'}`,
    cursor: 'pointer',
    transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
  }
}

// ── JSON textarea fallback (for intents not yet in the schema) ────────────────
function JsonFallback({ value, onChange, onError }) {
  const t = useT()
  const stringify = (v) =>
    typeof v === 'string' ? v : JSON.stringify(v || {}, null, 2)

  const [raw, setRaw] = useState(() => stringify(value))
  const [err, setErr] = useState(null)

  useEffect(() => {
    setRaw(stringify(value))
  }, [])

  const handleChange = (e) => {
    const s = e.target.value
    setRaw(s)
    try {
      const parsed = JSON.parse(s)
      setErr(null)
      onError?.(null)
      onChange(parsed)
    } catch {
      const msg = t('intentForm.invalidJson')
      setErr(msg)
      onError?.(msg)
    }
  }

  return (
    <div>
      <p style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
        {t('intentForm.params')}{' '}
        <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>{t('intentForm.paramsHint')}</span>
      </p>
      <textarea
        value={raw}
        onChange={handleChange}
        rows={2}
        spellCheck={false}
        placeholder='{"room": "office"}'
        className="z-code"
        style={{
          width: '100%', padding: '12px 16px', borderRadius: 'var(--r-ctl)', minHeight: 44,
          background: 'var(--surface)', border: `0.5px solid ${err ? 'var(--err)' : 'var(--line)'}`,
          color: 'var(--ink)', fontSize: 15, lineHeight: '20px',
          outline: 'none', resize: 'none', boxSizing: 'border-box',
          transition: 'border-color var(--dur-press) var(--ease-standard)',
        }}
      />
      {err && <p style={{ fontSize: 13, lineHeight: '18px', color: 'var(--err-text)', marginTop: 4 }}>{err}</p>}
    </div>
  )
}

// ── Single param field ────────────────────────────────────────────────────────
function ParamField({ param, value, onChange, rooms, entities, allValues }) {
  const t = useT()
  const { key, label, type, options, required, placeholder, min, max, step, unit, source, domainFilter, dependsOn } = param

  const Label = () => (
    <p style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
      {label}
      {!required && (
        <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}> ({t('intentForm.optional')})</span>
      )}
    </p>
  )

  // Two-chip toggle: Turn On / Turn Off or custom pair
  if (type === 'boolean_select') {
    const opts = options || [
      { value: true,  label: t('intentForm.turnOn') },
      { value: false, label: t('intentForm.turnOff') },
    ]
    return (
      <div>
        <Label />
        <div style={{ display: 'flex', gap: 8 }}>
          {opts.map((opt) => {
            const active = value === opt.value
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onChange(opt.value)}
                aria-pressed={active}
                style={{ ...chipStyle(active), flex: 1 }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Static option set: chips (≤4) or dropdown (>4)
  if (type === 'select') {
    if (options.length <= 4) {
      return (
        <div>
          <Label />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {options.map((opt) => {
              const active = value === opt.value
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange(opt.value)}
                  aria-pressed={active}
                  style={chipStyle(active)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )
    }
    return (
      <div>
        <Label />
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="z-input"
          style={{ height: 44, padding: '0 16px', width: '100%' }}
        >
          {!required && <option value="">—</option>}
          {required && !value && (
            <option value="" disabled>{t('intentForm.selectPlaceholder', { label: label.toLowerCase() })}</option>
          )}
          {options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
          ))}
        </select>
      </div>
    )
  }

  // Dynamic dropdown — rooms or entities filtered by room+domain
  if (type === 'dynamic_select') {
    let opts = []
    let loading = false

    if (source === 'rooms') {
      opts = rooms.map((r) => ({
        value: r.name.toLowerCase().replace(/\s+/g, '_'),
        label: r.name,
      }))
      loading = opts.length === 0
    } else if (source === 'entities_in_room') {
      const parentRoom = dependsOn ? (allValues?.[dependsOn] ?? '') : ''
      if (!parentRoom) {
        // Parent not selected yet — show disabled placeholder
        return (
          <div>
            <Label />
            <select disabled className="z-input" style={{ height: 44, padding: '0 16px', width: '100%' }}>
              <option>{t('intentForm.selectRoomFirst')}</option>
            </select>
          </div>
        )
      }
      // Find the HA area that matches the selected room value
      const area = rooms.find(
        (r) => r.name.toLowerCase().replace(/\s+/g, '_') === parentRoom
      )
      const areaEntityIds = new Set(area?.entities || [])
      opts = entities
        .filter((e) => areaEntityIds.has(e.entity_id) && (!domainFilter || e.domain === domainFilter))
        .map((e) => ({
          value: e.entity_id,
          label: e.display_name || e.friendly_name || e.entity_id,
        }))
    }

    return (
      <div>
        <Label />
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="z-input"
          style={{ height: 44, padding: '0 16px', width: '100%' }}
        >
          {!required && <option value="">{placeholder || '—'}</option>}
          {required && !value && (
            <option value="" disabled>
              {loading
                ? t('intentForm.loadingLabel', { label: label.toLowerCase() })
                : t('intentForm.selectPlaceholder', { label: label.toLowerCase() })}
            </option>
          )}
          {opts.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    )
  }

  // Slider + value badge
  if (type === 'number') {
    const numVal = value !== undefined && value !== '' ? Number(value) : (min ?? 0)
    return (
      <div>
        <Label />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={min ?? 0} max={max ?? 100} step={step || 1}
            value={numVal}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <div className="z-mono" style={{
            minWidth: 64, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0, padding: '0 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            fontSize: 17, fontWeight: 500, color: 'var(--ink)',
          }}>
            {numVal}{unit || ''}
          </div>
        </div>
        <p className="z-mono" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-mute)', marginTop: 4 }}>
          {min}{unit} – {max}{unit}
        </p>
      </div>
    )
  }

  // Free-text input
  if (type === 'text') {
    return (
      <div>
        <Label />
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || ''}
          className="z-input"
          style={{ height: 44, padding: '0 16px', width: '100%', boxSizing: 'border-box' }}
        />
      </div>
    )
  }

  return null
}

// ── Public component ──────────────────────────────────────────────────────────
/**
 * Renders a structured param form for the given intent.
 * Falls back to a JSON textarea for intents not in the schema.
 *
 * Props:
 *   intent   — string intent name
 *   value    — current params object
 *   onChange — called with the updated params object on every change
 *   onError  — called with an error string (or null) for validation feedback
 */
export function IntentParamForm({ intent, value = {}, onChange, onError }) {
  const t = useT()
  const schema = INTENT_PARAM_SCHEMA[intent]
  const [rooms, setRooms] = useState([])
  const entities      = useDeviceStore((s) => s.entities)
  const fetchAll      = useDeviceStore((s) => s.fetchAll)

  const needsRooms    = schema?.params.some((p) => p.source === 'rooms' || p.source === 'entities_in_room')
  const needsEntities = schema?.params.some((p) => p.source === 'entities_in_room')

  useEffect(() => {
    if (!needsRooms) return
    getRooms()
      .then((res) => setRooms(res.rooms || []))
      .catch(() => setRooms([]))
  }, [intent, needsRooms])

  useEffect(() => {
    if (needsEntities && entities.length === 0) fetchAll()
  }, [intent, needsEntities])

  if (!schema) {
    return <JsonFallback value={value} onChange={onChange} onError={onError} />
  }

  const { params } = schema

  if (params.length === 0) {
    return (
      <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)', padding: '4px 0' }}>
        {t('intentForm.noParams')}
      </p>
    )
  }

  const handleChange = (key, val) => {
    const next = { ...value, [key]: val }
    // Clear any param that dependsOn this key (e.g. entity_id depends on room)
    for (const p of params) {
      if (p.dependsOn === key) delete next[p.key]
    }
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {params.map((param) => (
        <ParamField
          key={param.key}
          param={param}
          value={value[param.key]}
          onChange={(val) => handleChange(param.key, val)}
          rooms={rooms}
          entities={entities}
          allValues={value}
        />
      ))}
    </div>
  )
}

// Validate a params object against a schema. Returns an array of missing field labels.
export function validateIntentParams(intent, params) {
  const schema = INTENT_PARAM_SCHEMA[intent]
  if (!schema) return []
  return schema.params
    .filter((p) => p.required && (params[p.key] === undefined || params[p.key] === '' || params[p.key] === null))
    .map((p) => p.label)
}
