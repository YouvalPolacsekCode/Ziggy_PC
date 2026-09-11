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
              aria-label={field.label}
              style={{ flex: 1, height: 44, accentColor: 'var(--ink)' }}
            />
          )}
          <input
            type="number"
            min={min} max={max} step={step}
            value={value ?? field.default ?? ''}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            className="z-input z-mono"
            style={{ width: 104, textAlign: 'end' }}
          />
          {unit && <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{unit.trim()}</span>}
        </div>
      )
    }

    case 'boolean':
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={Boolean(value ?? field.default ?? false)}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 20, height: 20, accentColor: 'var(--ink)' }}
          />
          <span style={{ fontSize: 17, color: 'var(--ink)' }}>{field.label}</span>
        </label>
      )

    case 'select':
      return (
        <select
          value={value ?? field.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="z-input"
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
          className="z-input"
        />
      )

    case 'duration': {
      // HA `duration` selectors are typically { hours, minutes, seconds }.
      // We render a single "minutes" input as the common case; user can refine later.
      const minutes = (value && typeof value === 'object') ? value.minutes : (value ?? field.default ?? 0)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number" min={0} max={1440}
            value={minutes ?? 0}
            onChange={(e) => onChange({ minutes: Number(e.target.value) })}
            className="z-input z-mono"
            style={{ width: 104, textAlign: 'end' }}
          />
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{i18nT('dynCmd.minutes')}</span>
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
          className="z-input"
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
      borderTop: '0.5px solid var(--line)',
      padding: '8px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => (hasFields ? setOpen(o => !o) : fire())}
          disabled={busy}
          aria-expanded={hasFields ? open : undefined}
          className="z-btn-secondary"
          style={{
            flex: 1, textAlign: 'start', justifyContent: 'space-between', fontWeight: 500,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cmd.label}</span>
            {cmd.source === 'ir' && (
              <span className="z-chip">{i18nT('dynCmd.irBadge')}</span>
            )}
          </span>
          {hasFields
            ? <ChevronDown size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--ink-mute)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
            : (busy ? <Loader2 size={18} strokeWidth={1.75} className="z-spin" style={{ flexShrink: 0 }} /> : <Send size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--ink-mute)' }} />)
          }
        </button>
      </div>

      {hasFields && open && (
        <div style={{
          marginTop: 8, padding: 12, borderRadius: 'var(--r-ctl)',
          background: 'var(--surface-2)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {cmd.description && (
            <div style={{ fontSize: 15, color: 'var(--ink-mute)' }}>{cmd.description}</div>
          )}
          {cmd.fields.map((f) => (
            <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
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
            className="z-btn-primary"
            style={{ alignSelf: 'flex-end', opacity: busy ? 0.5 : 1 }}
          >
            {busy ? i18nT('dynCmd.running') : i18nT('dynCmd.run')}
          </button>
        </div>
      )}

      {result && (
        <div style={{
          marginTop: 8, fontSize: 13,
          color: result.ok ? 'var(--ok-text)' : 'var(--err-text)',
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
    <div className="z-card" style={{ padding: '4px 16px', marginBottom: 16 }}>
      <button
        onClick={() => setExpanded(x => !x)}
        aria-expanded={expanded}
        className="z-headline"
        style={{
          width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 0, background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
        }}
      >
        <span>{i18nT('dynCmd.moreCommands')}{commands == null ? '' : ` (${visible.length})`}</span>
        <ChevronDown
          size={18}
          strokeWidth={1.75}
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--dur-state) var(--ease-standard)',
            color: 'var(--ink-mute)',
          }}
        />
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {visible.map((cmd) => (
            <CommandRow key={cmd.id} entityId={entityId} cmd={cmd} />
          ))}
        </div>
      )}
    </div>
  )
}
