import React from 'react'
import { Input } from '../../../ui/Input'
import { Toggle } from '../../../ui/Toggle'
import { useT } from '../../../../lib/i18n'
import { pickedIds } from './context'

// ── Shared field vocabulary ───────────────────────────────────────────────────
// Every bundle wizard/editor renders its questions through these renderers, so
// a device picker, a toggle row, or a time window looks and behaves identically
// in every bundle. A field is a plain object:
//   { key, type, labelKey?|label(fn), subKey?, icon?, visibleWhen?(values,ctx),
//     locked?(values,ctx), ...type-specific opts }
// `custom` is the escape hatch: anything truly bespoke still renders inside the
// shared frame so it looks like family.

// Resolve a label that may be a static i18n key or a fn(t, values, ctx).
const L = (t, values, ctx, key, fn, params) =>
  fn ? fn(t, values, ctx) : (key ? t(key, params) : '')

// ── Shared visual atoms (the single source of the look) ──────────────────────

export const listBox = {
  display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)',
  borderRadius: 10, padding: 6, background: 'var(--surface)', maxHeight: 180, overflowY: 'auto',
}

export function Eyebrow({ children }) {
  return <p className="z-eyebrow" style={{ marginBottom: 8 }}>{children}</p>
}

export function WarnBox({ children }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', margin: 0,
      background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
      {children}
    </p>
  )
}

export function HintText({ children }) {
  return <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', margin: '6px 2px 0', lineHeight: 1.5 }} dir="auto">{children}</p>
}

export function CheckMark() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>
  )
}

export function CheckRow({ label, sub, on, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7,
        background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%' }}>
      <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0,
        border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line)'}`, background: on ? 'var(--ok)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {on && <CheckMark />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">{sub}</span>}
      </span>
    </button>
  )
}

export function RadioRow({ label, sub, sel, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 8,
        background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%' }}>
      <span style={{ width: 14, height: 14, borderRadius: 999, flexShrink: 0, marginTop: 2,
        border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.4 }} dir="auto">{sub}</span>}
      </span>
    </button>
  )
}

export function Pill({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
        fontFamily: 'inherit', border: selected ? 'none' : '0.5px solid var(--line)',
        background: selected ? 'var(--ink)' : 'var(--surface)', color: selected ? 'var(--bg)' : 'var(--ink-mute)' }} dir="auto">
      {children}
    </button>
  )
}

export function ToggleRow({ label, sub, checked, onChange, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '11px 13px', borderTop: border ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 1 }} dir="auto">{sub}</span>}
      </span>
      <Toggle checked={checked} onCheckedChange={onChange} />
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
        <div style={{ display: 'flex', gap: 6, marginBottom: showList ? 8 : 0 }}>
          <Pill selected={v.mode === 'all'} onClick={() => setMode('all')}>
            {field.icon ? `${field.icon} ` : ''}{t(field.allKey || 'automations.bundles.all')}
          </Pill>
          <Pill selected={v.mode === 'choose'} onClick={() => setMode('choose')}>
            {field.icon ? `${field.icon} ` : ''}{t(field.chooseKey || 'automations.bundles.choose')}
          </Pill>
        </div>
      )}
      {showList && (
        <div style={listBox}>
          {items.map((it, i) => (
            <React.Fragment key={it.id}>
              {field.andConnector && i > 0 && (
                <div style={{ padding: '1px 12px' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: 'var(--ink-faint)' }} dir="auto">
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
        <p style={{ fontSize: 12.5, color: 'var(--ink)', padding: '9px 11px', margin: 0,
          border: '0.5px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }} dir="auto">
          {field.icon ? `${field.icon} ` : ''}{items[0].label}
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
          <RadioRow key={it.id} label={`${it.icon || field.icon ? `${it.icon || field.icon} ` : ''}${it.label}`}
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
        borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
        {field.options.map((opt) => (
          <RadioRow key={String(opt.value)}
            label={`${opt.icon ? `${opt.icon} ` : ''}${t(opt.labelKey)}`}
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
    <ToggleRow label={`${field.icon ? `${field.icon} ` : ''}${label}`} sub={sub}
      checked={!!values[field.key]} onChange={(v) => setValue(field.key, v)} border={borderTop} />
  )
}

function NumberField({ field, values, setValue, ctx, t, borderTop }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px',
      borderTop: borderTop ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1 }} dir="auto">
        {field.icon ? `${field.icon} ` : ''}{label}
      </span>
      <div style={{ width: field.width || 60 }}>
        <Input type="number" inputMode={field.step && field.step < 1 ? 'decimal' : 'numeric'}
          min={field.min} max={field.max} step={field.step}
          value={values[field.key]}
          onChange={(e) => setValue(field.key, e.target.value)} />
      </div>
      {(field.suffix || field.suffixKey) && (
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">
          {field.suffix || t(field.suffixKey)}
        </span>
      )}
    </div>
  )
}

function SliderField({ field, values, setValue, ctx, t }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }} dir="auto">{label}</span>
        <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>
          {values[field.key]}{field.suffix || ''}
        </span>
      </div>
      <input type="range" min={field.min} max={field.max} step={field.step || 1}
        value={values[field.key]}
        onChange={(e) => setValue(field.key, Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--ok)' }} />
    </div>
  )
}

function TimeField({ field, values, setValue, ctx, t, borderTop }) {
  const label = L(t, values, ctx, field.labelKey, field.label)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px',
      borderTop: borderTop ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1 }} dir="auto">
        {field.icon ? `${field.icon} ` : ''}{label}
      </span>
      <div style={{ width: 100 }}>
        <Input type="time" value={values[field.key]} onChange={(e) => setValue(field.key, e.target.value)} />
      </div>
    </div>
  )
}

function TimeWindowField({ field, values, setValue, ctx, t, borderTop }) {
  const [fromKey, toKey] = field.keys || ['after', 'before']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 13px 11px',
      borderTop: borderTop ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t(field.fromKey || 'automations.bundles.from')}</span>
      <div style={{ width: 92 }}>
        <Input type="time" value={values[fromKey]} onChange={(e) => setValue(fromKey, e.target.value)} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t(field.toKey || 'automations.bundles.to')}</span>
      <div style={{ width: 92 }}>
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
      <div key={`card-${out.length}`} style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
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
        <div key={f.key} style={{ fontSize: 12.5, color: 'var(--ink)', padding: '9px 11px',
          border: '0.5px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }} dir="auto">
          {f.lockedLabel ? f.lockedLabel(t, values, ctx) : String(values[f.key] ?? '')}
        </div>,
      )
      continue
    }
    if (CARD_TYPES.has(f.type) && !f.standalone) card.push(f)
    else { flushCard(); out.push(<React.Fragment key={f.key || f.textKey || out.length}>{renderOne(f, { values, setValue, ctx, t, isInstalled })}</React.Fragment>) }
  }
  flushCard()
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{out}</div>
}

export { pickedIds }
