// Per-card settings sheet, and the tap-to-expand overlay.
//
// The manifests have declared a `configSchema` since day one, but nothing ever
// rendered it — so a card with a choice to make (which room? which camera?)
// silently used the first item it found. That is why the single-room card was
// permanently stuck on whichever room happened to sort first.
//
// One sheet renders every schema kind, so a new module gets its settings UI for
// free by declaring the schema and nothing else.

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useDeviceStore } from '../stores/deviceStore'
import { useWallStore } from '../stores/wallStore'
import { useT, useTranslatedName } from '../lib/i18n'
import { getLists, getCameras, getRoutines, getQuickAsks } from '../lib/api'
import { getManifest } from './modules/registry'
import { MODULE_COMPONENTS } from './modules/components'

// ─── option sources ─────────────────────────────────────────────────────────

/** Choices for one schema field, loaded from whatever already knows them. */
function useOptions(kind) {
  const entities   = useDeviceStore((s) => s.entities)
  const ziggyRooms = useDeviceStore((s) => s.ziggyRooms)
  const [remote, setRemote] = useState(null)

  useEffect(() => {
    let dead = false
    const put = (v) => { if (!dead) setRemote(v) }
    if (kind === 'list')      getLists().then((r) => put((r?.lists || []).map((l) => ({ value: l.id, label: l.name })))).catch(() => put([]))
    else if (kind === 'camera') getCameras().then((r) => put(((r?.cameras || r || [])).map((c) => ({ value: c.entity_id || c.id, label: c.name || c.entity_id })))).catch(() => put([]))
    else if (kind === 'actionIds') {
      Promise.all([getRoutines().catch(() => null), getQuickAsks().catch(() => null)]).then(([rt, qa]) => {
        const rs = ((rt?.routines || rt || [])).map((r) => ({ value: `r:${r.id}`, label: r.name }))
        const qs = ((Array.isArray(qa) ? qa : qa?.quick_asks || [])).map((a) => ({ value: `a:${a.id}`, label: `${a.icon || ''} ${a.label}`.trim() }))
        put([...rs, ...qs])
      })
    }
    return () => { dead = true }
  }, [kind])

  return useMemo(() => {
    if (kind === 'entities') {
      // Only things a person can actually operate — offering 94 entities
      // including "Presence Sensor Target distance" would be a worse list
      // than no list.
      const CONTROLLABLE = new Set(['light', 'switch', 'media_player', 'climate', 'fan', 'lock', 'cover', 'water_heater'])
      return entities
        .filter((e) => CONTROLLABLE.has(e.domain || e.entity_id.split('.')[0]))
        .map((e) => ({ value: e.entity_id, label: e.display_name || e.friendly_name || e.entity_id }))
    }
    if (kind === 'room') {
      return (ziggyRooms || []).map((r) => ({ value: r.id, label: r.name }))
    }
    if (kind === 'mediaPlayer') {
      return entities
        .filter((e) => (e.domain || e.entity_id.split('.')[0]) === 'media_player')
        .map((e) => ({ value: e.entity_id, label: e.display_name || e.friendly_name || e.entity_id }))
    }
    return remote || []
  }, [kind, ziggyRooms, entities, remote])
}

// ─── field editors ──────────────────────────────────────────────────────────

const Row = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
    <span className="zw-eyebrow">{label}</span>
    {children}
  </div>
)

function ChoiceField({ label, options, value, onChange, allowNone }) {
  const t = useT()
  if (!options.length) {
    return <Row label={label}><div className="zw-empty" style={{ padding: 10 }}>{t('wall.cfg.none')}</div></Row>
  }
  return (
    <Row label={label}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {allowNone && (
          <button className={`zw-chip${value == null ? ' is-on' : ''}`} onClick={() => onChange(null)}>
            <span className="zw-chip-label">{t('wall.cfg.auto')}</span>
          </button>
        )}
        {options.map((o) => (
          <button
            key={o.value}
            className={`zw-chip${String(value) === String(o.value) ? ' is-on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            <span className="zw-chip-label">{o.label}</span>
          </button>
        ))}
      </div>
    </Row>
  )
}

function MultiField({ label, options, value, onChange }) {
  const t = useT()
  const set = new Set((value || []).map(String))
  if (!options.length) {
    return <Row label={label}><div className="zw-empty" style={{ padding: 10 }}>{t('wall.cfg.none')}</div></Row>
  }
  return (
    <Row label={label}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => (
          <button
            key={o.value}
            className={`zw-chip${set.has(String(o.value)) ? ' is-on' : ''}`}
            onClick={() => {
              const next = new Set(set)
              next.has(String(o.value)) ? next.delete(String(o.value)) : next.add(String(o.value))
              onChange([...next])
            }}
          >
            <span className="zw-chip-label">{o.label}</span>
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{t('wall.cfg.multiHint')}</span>
    </Row>
  )
}

function NumberField({ label, value, onChange, min = 1, max = 20 }) {
  return (
    <Row label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="zw-step" onClick={() => onChange(Math.max(min, (value ?? min) - 1))}>−</button>
        <span className="zw-temp" style={{ minWidth: 44 }}>{value ?? min}</span>
        <button className="zw-step" onClick={() => onChange(Math.min(max, (value ?? min) + 1))}>+</button>
      </div>
    </Row>
  )
}

const FieldFor = memo(function FieldFor({ name, spec, value, onChange }) {
  const t = useT()
  const options = useOptions(spec.kind)
  const label = t(`wall.cfg.${name}`)
  if (spec.kind === 'number') {
    return <NumberField label={label} value={value} onChange={onChange} min={spec.min} max={spec.max} />
  }
  if (spec.kind === 'actionIds' || spec.kind === 'entities') {
    return <MultiField label={label} options={options} value={value} onChange={onChange} />
  }
  // room / list / camera / mediaPlayer all pick one of a list; `auto` means
  // "whatever makes sense", which is the behaviour before anything is chosen.
  return <ChoiceField label={label} options={options} value={value} onChange={onChange} allowNone />
})

// ─── the settings sheet ─────────────────────────────────────────────────────

export const ModuleConfigSheet = memo(function ModuleConfigSheet({ modId, onClose }) {
  const t = useT()
  const draft = useWallStore((s) => s.draft)
  const configureModule = useWallStore((s) => s.configureModule)

  const mod = useMemo(() => (draft?.modules || []).find((m) => m.id === modId), [draft, modId])
  const manifest = mod ? getManifest(mod.type) : null

  if (!mod || !manifest) return null
  const schema = manifest.configSchema || {}
  const fields = Object.entries(schema)

  return (
    <div className="zw-scrim" onClick={onClose}>
      <div className="zw-modal" style={{ width: 'min(520px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="zw-modal-head">
          <div className="zw-modal-title">{t(manifest.titleKey)}</div>
          <button className="zw-btn zw-btn-icon" style={{ marginInlineStart: 'auto' }} onClick={onClose}>✕</button>
        </div>
        <div className="zw-modal-body" style={{ paddingTop: 16 }}>
          {fields.length === 0
            ? <div className="zw-empty">{t('wall.cfg.nothing')}</div>
            : fields.map(([name, spec]) => (
                <FieldFor
                  key={name}
                  name={name}
                  spec={spec}
                  value={mod.config?.[name] ?? spec.default}
                  onChange={(v) => configureModule(mod.id, { [name]: v })}
                />
              ))}
        </div>
      </div>
    </div>
  )
})

// ─── tap-to-expand ──────────────────────────────────────────────────────────

/**
 * The same module, rendered large over the board.
 *
 * A wall card is sized to be readable across a room, which means a shopping
 * list or a day's agenda shows only its first few rows. Tapping it opens the
 * identical component at full size — same data, same live updates, same
 * controls, just room to breathe.
 */
export const ModuleExpanded = memo(function ModuleExpanded({ mod, ctx, onClose }) {
  const t = useT()
  const manifest = mod ? getManifest(mod.type) : null
  const Component = mod ? MODULE_COMPONENTS[mod.type] : null

  // Escape closes, matching every other overlay on the wall.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mod || !Component) return null

  return (
    <div className="zw-scrim" onClick={onClose}>
      <div className="zw-expand" onClick={(e) => e.stopPropagation()}>
        <button className="zw-expand-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        {/* zw-mod re-establishes the query container, so the card's contents
            size themselves to the LARGE box rather than staying tile-sized. */}
        <div className="zw-mod zw-mod-expanded">
          <Component mod={mod} manifest={manifest} ctx={ctx} />
        </div>
      </div>
    </div>
  )
})
