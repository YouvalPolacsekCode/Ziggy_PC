import { useState, useEffect } from 'react'
import { getRooms } from '../../lib/api'
import { useDeviceStore } from '../../stores/deviceStore'
import { INTENT_PARAM_SCHEMA } from '../../lib/intentParamSchema'
import { useT } from '../../lib/i18n'

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
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
        {t('intentForm.params')}{' '}
        <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>{t('intentForm.paramsHint')}</span>
      </p>
      <textarea
        value={raw}
        onChange={handleChange}
        rows={2}
        spellCheck={false}
        placeholder='{"room": "office"}'
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 10,
          background: 'var(--surface)', border: `0.5px solid ${err ? 'var(--accent)' : 'var(--line)'}`,
          color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace', fontSize: 12,
          outline: 'none', resize: 'none', boxSizing: 'border-box',
        }}
      />
      {err && <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>{err}</p>}
    </div>
  )
}

// ── Single param field ────────────────────────────────────────────────────────
function ParamField({ param, value, onChange, rooms, entities, allValues }) {
  const t = useT()
  const { key, label, type, options, required, placeholder, min, max, step, unit, source, domainFilter, dependsOn } = param

  const Label = () => (
    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
      {label}
      {!required && (
        <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}> ({t('intentForm.optional')})</span>
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
        <div style={{ display: 'flex', gap: 6 }}>
          {opts.map((opt) => {
            const active = value === opt.value
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onChange(opt.value)}
                style={{
                  flex: 1, height: 36, borderRadius: 9,
                  fontSize: 13, fontWeight: 500,
                  background: active ? 'var(--accent)' : 'var(--bg-2)',
                  color: active ? '#fff' : 'var(--ink-2)',
                  border: active ? '0.5px solid var(--accent)' : '0.5px solid var(--line)',
                  cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
                }}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {options.map((opt) => {
              const active = value === opt.value
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange(opt.value)}
                  style={{
                    padding: '6px 14px', borderRadius: 9, fontSize: 12, fontWeight: 500,
                    background: active ? 'var(--accent)' : 'var(--bg-2)',
                    color: active ? '#fff' : 'var(--ink-2)',
                    border: active ? '0.5px solid var(--accent)' : '0.5px solid var(--line)',
                    cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
                  }}
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
          style={{ height: 40, padding: '0 12px', width: '100%' }}
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
          <div style={{ opacity: 0.45 }}>
            <Label />
            <select disabled className="z-input" style={{ height: 40, padding: '0 12px', width: '100%' }}>
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
          style={{ height: 40, padding: '0 12px', width: '100%' }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range"
            min={min ?? 0} max={max ?? 100} step={step || 1}
            value={numVal}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <div style={{
            minWidth: 58, height: 36, borderRadius: 9, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-2)', border: '0.5px solid var(--line)',
            fontSize: 13, fontWeight: 500, color: 'var(--ink)',
            fontFamily: '"IBM Plex Mono", monospace',
          }}>
            {numVal}{unit || ''}
          </div>
        </div>
        <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 3 }}>
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
          style={{ height: 40, padding: '0 12px', width: '100%', boxSizing: 'border-box' }}
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
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '4px 0' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
