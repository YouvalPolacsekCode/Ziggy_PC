import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Send, Loader2 } from 'lucide-react'
import { getDeviceCommands, executeDeviceCommand } from '../../lib/api'
import { useDeviceStore } from '../../stores/deviceStore'
import { useT, t as i18nT } from '../../lib/i18n'

/**
 * "More Commands" panel — generic UI over services/ha_capabilities.
 *
 * Renders every command the backend reports for this entity. Curated hero
 * remotes (ACRemote, TVRemote) live above this; this panel is additive and
 * exposes the long tail (set_swing_mode, switcher.turn_on_with_timer,
 * select_source, etc.) that the curated UI doesn't cover.
 *
 * Layout: collapsed by default. Each command is a row; commands with no
 * params execute immediately on tap, commands with params expand into a
 * small form.
 */

const VERB_FILTER = new Set(['turn_on', 'turn_off', 'toggle'])

function FieldInput({ field, value, onChange }) {
  const placeholder = field.description || field.label
  const common = { onChange, style: { width: '100%' } }

  switch (field.kind) {
    case 'number': {
      const min = field.min ?? 0
      const max = field.max ?? 100
      const step = field.step ?? 1
      const unit = field.unit ? ` ${field.unit}` : ''
      const isSlider = (field.mode === 'slider') || (max - min <= 1000 && step >= 1)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isSlider && (
            <input
              type="range"
              min={min} max={max} step={step}
              value={value ?? field.default ?? min}
              onChange={(e) => onChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          )}
          <input
            type="number"
            min={min} max={max} step={step}
            value={value ?? field.default ?? ''}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{
              width: 88, padding: '6px 8px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--ink)', fontSize: 13, textAlign: 'right',
            }}
          />
          {unit && <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{unit.trim()}</span>}
        </div>
      )
    }

    case 'boolean':
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(value ?? field.default ?? false)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span style={{ fontSize: 12 }}>{field.label}</span>
        </label>
      )

    case 'select':
      return (
        <select
          value={value ?? field.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, ...common.style,
          }}
        >
          <option value="">{i18nT('dynCmd.select')}</option>
          {(field.options || []).map((opt) => {
            const v = typeof opt === 'object' ? (opt.value ?? opt.id ?? opt.label) : opt
            const l = typeof opt === 'object' ? (opt.label ?? opt.value ?? opt.id) : opt
            return <option key={v} value={v}>{l}</option>
          })}
        </select>
      )

    case 'time':
      return (
        <input
          type="time"
          value={value ?? field.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, ...common.style,
          }}
        />
      )

    case 'duration': {
      // HA `duration` selectors are typically { hours, minutes, seconds }.
      // We render a single "minutes" input as the common case; user can refine later.
      const minutes = (value && typeof value === 'object') ? value.minutes : (value ?? field.default ?? 0)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} max={1440}
            value={minutes ?? 0}
            onChange={(e) => onChange({ minutes: Number(e.target.value) })}
            style={{
              width: 80, padding: '6px 8px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--ink)', fontSize: 13, textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>min</span>
        </div>
      )
    }

    case 'text':
    default:
      return (
        <input
          type="text"
          value={value ?? field.default ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, ...common.style,
          }}
        />
      )
  }
}

function CommandRow({ entityId, cmd, onExecuted }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [params, setParams] = useState({})

  const hasFields = (cmd.fields || []).length > 0

  async function fire() {
    setBusy(true)
    setResult(null)
    try {
      const r = await executeDeviceCommand(entityId, cmd.id, params)
      setResult({ ok: !!r?.ok, message: r?.message || (r?.ok ? i18nT('dynCmd.done') : i18nT('dynCmd.failed')) })
      if (onExecuted) onExecuted(cmd, r)
    } catch (e) {
      setResult({ ok: false, message: e?.message || i18nT('dynCmd.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      padding: '10px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => (hasFields ? setOpen(o => !o) : fire())}
          disabled={busy}
          style={{
            flex: 1, textAlign: 'left', padding: '6px 10px', borderRadius: 10,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--ink)', cursor: 'pointer', fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            opacity: busy ? 0.5 : 1,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cmd.label}
            {cmd.source === 'ir' && (
              <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--ink-mute)', verticalAlign: 'middle' }}>IR</span>
            )}
          </span>
          {hasFields
            ? <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            : (busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />)
          }
        </button>
      </div>

      {hasFields && open && (
        <div style={{
          marginTop: 8, padding: 10, borderRadius: 10,
          background: 'var(--surface-2)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {cmd.description && (
            <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{cmd.description}</div>
          )}
          {cmd.fields.map((f) => (
            <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                {f.label}{f.required ? ' *' : ''}
              </span>
              <FieldInput
                field={f}
                value={params[f.name]}
                onChange={(v) => setParams(p => ({ ...p, [f.name]: v }))}
              />
            </div>
          ))}
          <button
            onClick={fire}
            disabled={busy}
            style={{
              alignSelf: 'flex-end', padding: '6px 14px', borderRadius: 10,
              background: 'var(--accent)', color: 'white', border: 'none',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>
      )}

      {result && (
        <div style={{
          marginTop: 6, fontSize: 11,
          color: result.ok ? 'var(--ok)' : 'var(--err)',
        }}>
          {result.message}
        </div>
      )}
    </div>
  )
}

export default function DynamicCommands({ entityId, hideVerbs }) {
  const [commands, setCommands] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(null)
  // Reachability gate: only re-fetch when the entity transitions between
  // available <-> unavailable. A TV reports new services (select_source etc.)
  // once it's reachable, but firing on every play/pause/buffer state change
  // floods the backend (one HA service-catalog round-trip per fetch).
  const isAvailable = useDeviceStore(
    (s) => (s.entities.find((e) => e.entity_id === entityId)?.state ?? 'unknown') !== 'unavailable'
  )

  // Lazy: defer the catalog fetch until the user actually opens the panel.
  // The hero remote covers ~90% of interactions; most device pages never need
  // the "More Commands" catalog at all. Hidden cost was one /commands round
  // trip per page mount (and per state change) for every device opened.
  useEffect(() => {
    if (!entityId) return
    if (!expanded && commands == null) return        // not opened yet — defer
    let cancelled = false
    setError(null)
    getDeviceCommands(entityId)
      .then((r) => { if (!cancelled) setCommands(r?.commands || []) })
      .catch((e) => {
        // The api layer hands us a ZiggyApiError; userMessage is already
        // localized and sanitized. The catalog is opt-in so we silently hide
        // on failure rather than spam the device card with an error band.
        if (!cancelled) setError(e?.userMessage || 'unavailable')
      })
    return () => { cancelled = true }
  }, [entityId, expanded, isAvailable])

  // Filter out commands already represented by hero remote (turn_on/off/toggle)
  // unless explicitly opted in.
  const visible = useMemo(() => {
    const list = commands || []
    const skip = new Set(hideVerbs || ['turn_on', 'turn_off', 'toggle'])
    return list.filter(c => !skip.has(c.service))
  }, [commands, hideVerbs])

  // Hide on silent failure; otherwise always render the collapsed header so
  // the user can opt-in to load the catalog. Header alone is cheap.
  if (!entityId || error) return null
  if (commands != null && visible.length === 0) return null

  return (
    <div className="z-card" style={{ padding: 12, marginBottom: 14, borderRadius: 18 }}>
      <button
        onClick={() => setExpanded(x => !x)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 4px', background: 'transparent', border: 'none', color: 'var(--ink)',
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }}
      >
        <span>More Commands{commands == null ? '' : ` (${visible.length})`}</span>
        <ChevronDown
          size={14}
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            color: 'var(--ink-mute)',
          }}
        />
      </button>

      {expanded && (
        <div style={{ marginTop: 6 }}>
          {visible.map((cmd) => (
            <CommandRow key={cmd.id} entityId={entityId} cmd={cmd} />
          ))}
        </div>
      )}
    </div>
  )
}
