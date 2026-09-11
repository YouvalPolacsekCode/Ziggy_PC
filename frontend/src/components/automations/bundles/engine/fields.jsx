import React from 'react'
import { Check } from 'lucide-react'
import { Input } from '../../../ui/Input'
import { Toggle } from '../../../ui/Toggle'
import { useT } from '../../../../lib/i18n'
import { chipStyle } from '../../../../lib/automations/styles'
import { pickedIds } from './context'

// ── Shared field vocabulary ───────────────────────────────────────────────────
// Every bundle wizard/editor renders its questions through these renderers, so
// a device picker, a toggle row, or a time window looks and behaves identically
// in every bundle. A field is a plain object:
//   { key, type, labelKey?|label(fn), subKey?, icon?, visibleWhen?(values,ctx),
//     locked?(values,ctx), ...type-specific opts }
// `custom` is the escape hatch: anything truly bespoke still renders inside the
// shared frame so it looks like family.
//
// HIG pass: rows are 44px (list) / 56px (with a control), labels are Body
// (17) or Subhead (15), sub-lines are Footnote (13), check/radio marks are
// 20px, chips are 44px tall with the surface-2 active state. The recipes'
// emoji `icon` fields are no longer drawn — words carry the meaning.

// Resolve a label that may be a static i18n key or a fn(t, values, ctx).
const L = (t, values, ctx, key, fn, params) =>
  fn ? fn(t, values, ctx) : (key ? t(key, params) : '')

// ── Shared visual atoms (the single source of the look) ──────────────────────

export const listBox = {
  display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-ctl)', padding: 8, background: 'var(--surface)', maxHeight: 240, overflowY: 'auto',
}

export function Eyebrow({ children }) {
  return <p className="z-eyebrow" style={{ marginBottom: 8 }}>{children}</p>
}

export function WarnBox({ children }) {
  return (
    <p className="z-subhead" style={{ color: 'var(--warn-text)', padding: '12px 16px', margin: 0,
      background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))',
      border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))', borderRadius: 'var(--r-ctl)' }} dir="auto">
      {children}
    </p>
  )
}

export function HintText({ children }) {
  return <p className="z-subhead" style={{ margin: '8px 2px 0' }} dir="auto">{children}</p>
}

export function CheckMark() {
  return <Check size={14} strokeWidth={3} aria-hidden="true" style={{ color: 'var(--on-accent)' }} />
}

export function CheckRow({ label, sub, on, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '8px 12px', borderRadius: 'var(--r-chip)',
        background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%',
        transition: 'background var(--dur-press) var(--ease-standard)' }}>
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 'var(--r-chip)', flexShrink: 0,
        border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line-2)'}`, background: on ? 'var(--ok)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)' }}>
        {on && <CheckMark />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="z-subhead" style={{ display: 'block', color: 'var(--ink)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{label}</span>
        {sub && <span className="z-footnote" style={{ display: 'block' }} dir="auto">{sub}</span>}
      </span>
    </button>
  )
}

export function RadioRow({ label, sub, sel, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={sel}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minHeight: 44, padding: '10px 12px', borderRadius: 'var(--r-ctl)',
        background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%',
        transition: 'background var(--dur-press) var(--ease-standard)' }}>
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 999, flexShrink: 0,
        border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line-2)'}`, background: sel ? 'var(--ok)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)' }}>
        {sel && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--surface)' }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="z-subhead" style={{ display: 'block', color: 'var(--ink)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{label}</span>
        {sub && <span className="z-footnote" style={{ display: 'block' }} dir="auto">{sub}</span>}
      </span>
    </button>
  )
}

export function Pill({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} style={chipStyle(selected)} dir="auto">
      {children}
    </button>
  )
}

export function ToggleRow({ label, sub, checked, onChange, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 56,
      padding: '12px 16px', borderTop: border ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ minWidth: 0 }}>
        <span className="z-body" style={{ display: 'block' }} dir="auto">{label}</span>
        {sub && <span className="z-subhead" style={{ display: 'block', marginTop: 2 }} dir="auto">{sub}</span>}
      </span>
      <Toggle checked={checked} onCheckedChange={onChange} aria-label={typeof label === 'string' ? label : undefined} />
    </div>
  )
}

// ── Field renderers ──────────────────────────────────────────────────────────

function PickManyField({ field, values, setValue, ctx, t }) {
  const items = field.items(ctx, values) || []
  const v = values[field.key] || { mode: 'all', ids: [] }
  const label = L(t, values, ctx, field.labelKey, field.label)
  if (items.length === 0) {
    return (
      <div>
        {label && <Eyebrow>{label}</Eyebrow>}
        <WarnBox>{t(field.emptyKey || 'automations.bundles.noneAvailable')}</WarnBox>
      </div>
    )
  }
  const toggle = (id) => {
    const ids = new Set(v.ids || [])
    ids.has(id) ? ids.delete(id) : ids.add(id)
    setValue(field.key, { ...v, ids: Array.from(ids) })
  }
  const setMode = (mode) => {
    // Entering "choose" with nothing chosen pre-checks everything (legacy behavior).
    const ids = (mode === 'choose' && (v.ids || []).length === 0) ? items.map((i) => i.id) : (v.ids || [])
    setValue(field.key, { mode, ids })
  }
  const allToggle = field.allToggle !== false
  const showList = !allToggle || v.mode === 'choose'
  return (
    <div>
      {label && <Eyebrow>{label}</Eyebrow>}
      {allToggle && (
        <div style={{ display: 'flex', gap: 8, marginBottom: showList ? 8 : 0 }}>
          <Pill selected={v.mode === 'all'} onClick={() => setMode('all')}>
            {t(field.allKey || 'automations.bundles.all')}
          </Pill>
          <Pill selected={v.mode === 'choose'} onClick={() => setMode('choose')}>
            {t(field.chooseKey || 'automations.bundles.choose')}
          </Pill>
        </div>
      )}
      {showList && (
        <div style={listBox}>
          {items.map((it, i) => (
            <React.Fragment key={it.id}>
              {field.andConnector && i > 0 && (
                <div style={{ padding: '2px 12px' }}>
                  <span className="z-footnote" style={{ fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }} dir="auto">
                    {t(field.andKey || 'automations.bundles.and')}
                  </span>
                </div>
              )}
              <CheckRow label={it.label} sub={it.sub}
                on={(v.ids || []).includes(it.id)}
                onClick={() => toggle(it.id)} />
            </React.Fragment>
          ))}
        </div>
      )}
      {field.hintKey && <HintText>{t(field.hintKey)}</HintText>}
    </div>
  )
}

function PickOneField({ field, values, setValue, ctx, t }) {
  const items = field.items(ctx, values) || []
  const v = values[field.key]
  const label = L(t, values, ctx, field.labelKey, field.label)
  if (items.length === 0) {
    return (
      <div>
        {label && <Eyebrow>{label}</Eyebrow>}
        <WarnBox>{t(field.emptyKey || 'automations.bundles.noneAvailable')}</WarnBox>
      </div>
    )
  }
  // A single candidate reads as a static line, not a one-item radio list.
  if (items.length === 1 && field.collapseSingle !== false) {
    return (
      <div>
        {label && <Eyebrow>{label}</Eyebrow>}
        <p className="z-subhead" style={{ color: 'var(--ink)', minHeight: 44, display: 'flex', alignItems: 'center', padding: '8px 16px', margin: 0,
          border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', background: 'var(--surface)' }} dir="auto">
          {items[0].label}
        </p>
      </div>
    )
  }
  const set = (id) => {
    setValue(field.key, id)
    // afterSet lets a pick reset dependent values (e.g. new room → clear devices).
    if (field.afterSet) {
      const patch = field.afterSet(id, values, ctx) || {}
      Object.entries(patch).forEach(([k, val]) => setValue(k, val))
    }
  }
  return (
    <div>
      {label && <Eyebrow>{label}</Eyebrow>}
      <div style={listBox}>
        {items.map((it) => (
          <RadioRow key={it.id} label={it.label}
            sub={it.sub} sel={v === it.id} onClick={() => set(it.id)} />
        ))}
      </div>
      {field.hintKey && <HintText>{t(field.hintKey)}</HintText>}
    </div>
  )
}

function ChoiceField({ field, values, setValue, ctx, t }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div>
      {label && <Eyebrow>{label}</Eyebrow>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)',
        borderRadius: 'var(--r-ctl)', padding: 8, background: 'var(--surface)' }}>
        {field.options.map((opt) => (
          <RadioRow key={String(opt.value)}
            label={t(opt.labelKey)}
            sub={opt.descKey ? t(opt.descKey) : undefined}
            sel={values[field.key] === opt.value}
            onClick={() => setValue(field.key, opt.value)} />
        ))}
      </div>
      {field.hintKey && <HintText>{t(field.hintKey)}</HintText>}
    </div>
  )
}

// Consecutive toggle fields render inside one bordered card; the group wrapper
// is handled by the section renderer below.
function ToggleField({ field, values, setValue, ctx, t, borderTop }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  const sub = field.sub ? field.sub(t, values, ctx) : (field.subKey ? t(field.subKey) : undefined)
  return (
    <ToggleRow label={label} sub={sub}
      checked={!!values[field.key]} onChange={(v) => setValue(field.key, v)} border={borderTop} />
  )
}

function NumberField({ field, values, setValue, ctx, t, borderTop }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 16px',
      borderTop: borderTop ? '0.5px solid var(--line)' : 'none' }}>
      <span className="z-body" style={{ flex: 1, minWidth: 0 }} dir="auto">
        {label}
      </span>
      <div style={{ width: field.width ? Math.max(field.width, 88) : 88, flexShrink: 0 }}>
        <Input type="number" inputMode={field.step && field.step < 1 ? 'decimal' : 'numeric'}
          min={field.min} max={field.max} step={field.step}
          value={values[field.key]}
          onChange={(e) => setValue(field.key, e.target.value)} />
      </div>
      {(field.suffix || field.suffixKey) && (
        <span className="z-subhead" style={{ flexShrink: 0 }} dir="auto">
          {field.suffix || t(field.suffixKey)}
        </span>
      )}
    </div>
  )
}

function SliderField({ field, values, setValue, ctx, t }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="z-subhead" style={{ color: 'var(--ink-2)' }} dir="auto">{label}</span>
        <span className="z-subhead z-mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {values[field.key]}{field.suffix || ''}
        </span>
      </div>
      <input type="range" min={field.min} max={field.max} step={field.step || 1}
        value={values[field.key]}
        onChange={(e) => setValue(field.key, Number(e.target.value))}
        aria-label={label}
        style={{ width: '100%', accentColor: 'var(--ink)', minHeight: 44 }} />
    </div>
  )
}

function TimeField({ field, values, setValue, ctx, t, borderTop }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 16px',
      borderTop: borderTop ? '0.5px solid var(--line)' : 'none' }}>
      <span className="z-body" style={{ flex: 1, minWidth: 0 }} dir="auto">
        {label}
      </span>
      <div style={{ width: 128, flexShrink: 0 }}>
        <Input type="time" value={values[field.key]} onChange={(e) => setValue(field.key, e.target.value)} aria-label={label} />
      </div>
    </div>
  )
}

function TimeWindowField({ field, values, setValue, ctx, t, borderTop }) {
  const [fromKey, toKey] = field.keys || ['after', 'before']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 56, padding: '8px 16px', flexWrap: 'wrap',
      borderTop: borderTop ? '0.5px solid var(--line)' : 'none' }}>
      <span className="z-subhead" dir="auto">{t(field.fromKey || 'automations.bundles.from')}</span>
      <div style={{ width: 120 }}>
        <Input type="time" value={values[fromKey]} onChange={(e) => setValue(fromKey, e.target.value)} />
      </div>
      <span className="z-subhead" dir="auto">{t(field.toKey || 'automations.bundles.to')}</span>
      <div style={{ width: 120 }}>
        <Input type="time" value={values[toKey]} onChange={(e) => setValue(toKey, e.target.value)} />
      </div>
    </div>
  )
}

function NoteField({ field, values, ctx, t }) {
  const text = field.text ? field.text(t, values, ctx) : t(field.textKey)
  return <HintText>{text}</HintText>
}

function WarnIfField({ field, values, ctx, t }) {
  if (!field.when(values, ctx)) return null
  const text = field.text ? field.text(t, values, ctx) : t(field.textKey)
  return <WarnBox>{text}</WarnBox>
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

const CARD_TYPES = new Set(['toggle', 'number', 'time', 'timeWindow'])

function renderOne(field, props, borderTop) {
  const p = { ...props, field, borderTop }
  switch (field.type) {
    case 'pickMany':   return <PickManyField {...p} />
    case 'pickOne':    return <PickOneField {...p} />
    case 'choice':     return <ChoiceField {...p} />
    case 'toggle':     return <ToggleField {...p} />
    case 'number':     return <NumberField {...p} />
    case 'slider':     return <SliderField {...p} />
    case 'time':       return <TimeField {...p} />
    case 'timeWindow': return <TimeWindowField {...p} />
    case 'note':       return <NoteField {...p} />
    case 'warnIf':     return <WarnIfField {...p} />
    case 'custom':     return field.render(p)
    default:           return null
  }
}

// Render a list of fields: visible row-type fields (toggle/number/time) are
// grouped into shared bordered cards, everything else stands alone — this is
// the "options card" look every legacy wizard hand-built.
export function FieldList({ fields, values, setValue, ctx, isInstalled }) {
  const t = useT()
  const visible = (fields || []).filter((f) => !f.visibleWhen || f.visibleWhen(values, ctx))
  const out = []
  let card = []
  const flushCard = () => {
    if (!card.length) return
    const group = card
    out.push(
      <div key={`card-${out.length}`} style={{ border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', background: 'var(--surface)' }}>
        {group.map((f, i) => (
          <React.Fragment key={f.key || f.textKey || i}>
            {renderOne(f, { values, setValue, ctx, t, isInstalled }, i > 0)}
          </React.Fragment>
        ))}
      </div>,
    )
    card = []
  }
  for (const f of visible) {
    if (f.locked && f.locked(values, ctx)) {
      flushCard()
      out.push(
        <div key={f.key} className="z-subhead" style={{ color: 'var(--ink)', minHeight: 44, display: 'flex', alignItems: 'center', padding: '8px 16px',
          border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', background: 'var(--surface)' }} dir="auto">
          {f.lockedLabel ? f.lockedLabel(t, values, ctx) : String(values[f.key] ?? '')}
        </div>,
      )
      continue
    }
    if (CARD_TYPES.has(f.type) && !f.standalone) card.push(f)
    else { flushCard(); out.push(<React.Fragment key={f.key || f.textKey || out.length}>{renderOne(f, { values, setValue, ctx, t, isInstalled })}</React.Fragment>) }
  }
  flushCard()
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{out}</div>
}

// ── Locked summary ───────────────────────────────────────────────────────────
// The compact read-only view of an installed bundle: ONE line per setting
// (label · value), derived from the same field definitions — so the summary
// can never drift from the editor. Notes/warnings are skipped; custom fields
// opt in via `summary(t, values, ctx) -> string` or `lockedRender`.

function summaryValue(f, values, ctx, t) {
  const v = values[f.key]
  switch (f.type) {
    case 'pickMany': {
      const items = f.items(ctx, values) || []
      const ids = (v?.mode === 'choose' || f.allToggle === false) ? (v?.ids || []) : items.map((i) => i.id)
      if (v?.mode !== 'choose' && f.allToggle !== false) return t('automations.bundles.allN', { n: items.length })
      if (ids.length === 0) return '—'
      if (ids.length <= 3) {
        const label = (id) => items.find((i) => i.id === id)?.label || id
        return ids.map(label).join(' · ')
      }
      return t('automations.bundles.nChosen', { n: ids.length })
    }
    case 'pickOne': {
      const items = f.items(ctx, values) || []
      return items.find((i) => i.id === v)?.label || (v ?? '—')
    }
    case 'choice': {
      const opt = (f.options || []).find((o) => o.value === v)
      return opt ? t(opt.labelKey) : '—'
    }
    case 'toggle':     return v ? '✓' : '—'
    case 'number':
    case 'slider':     return `${v}${f.suffix || (f.suffixKey ? ` ${t(f.suffixKey)}` : '')}`
    case 'time':       return v || '—'
    case 'timeWindow': {
      const [fromKey, toKey] = f.keys || ['after', 'before']
      return `${values[fromKey] || '—'}–${values[toKey] || '—'}`
    }
    default: return null
  }
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '8px 0',
      borderBottom: '0.5px solid var(--line)' }}>
      <span className="z-subhead" style={{ flex: 1, minWidth: 0 }} dir="auto">{label}</span>
      <span className="z-subhead z-mono" style={{ color: 'var(--ink)', fontWeight: 600, textAlign: 'end', maxWidth: '55%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{value}</span>
    </div>
  )
}

export function SummaryList({ steps, values, ctx }) {
  const t = useT()
  const visibleSteps = (steps || []).filter((s) => !s.visibleWhen || s.visibleWhen(values, ctx))
  const out = []
  for (const s of visibleSteps) {
    const fields = (s.fields || []).filter((f) => !f.visibleWhen || f.visibleWhen(values, ctx))
    for (const f of fields) {
      if (f.type === 'note' || f.type === 'warnIf') continue
      if (f.type === 'custom') {
        if (f.lockedRender) {
          out.push(<React.Fragment key={f.key}>{f.lockedRender({ values, ctx, t })}</React.Fragment>)
        } else if (f.summary) {
          out.push(<SummaryRow key={f.key} label={s.titleKey ? t(s.titleKey) : ''}
            value={f.summary(t, values, ctx)} />)
        }
        continue
      }
      const value = summaryValue(f, values, ctx, t)
      if (value == null) continue
      const label = f.label ? f.label(t, values, ctx)
        : f.labelKey ? t(f.labelKey)
        : (s.titleKey ? t(s.titleKey) : '')
      out.push(<SummaryRow key={f.key} label={label} value={value} />)
    }
  }
  return <div style={{ display: 'flex', flexDirection: 'column' }}>{out}</div>
}

export { pickedIds }
