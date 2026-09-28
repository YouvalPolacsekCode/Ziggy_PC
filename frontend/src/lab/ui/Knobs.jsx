// Motion Lab — per-demo knobs (duration, bounce, stiffness, easing…).
// A knob whose label ends in "(B)" or "(A, C)" applies only to those
// variants; it is greyed out (with a hint) while another variant is shown.
// "Reset" restores every knob's default.
import { EASE_OPTIONS } from '../time'

function appliesTo(label) {
  const m = /\(([A-Z](?:\s*,\s*[A-Z])*)\)\s*$/.exec(label || '')
  return m ? m[1].split(',').map(s => s.trim()) : null
}

export function Knobs({ knobs, values, onChange, activeVariant }) {
  const set = (key, v) => onChange(prev => ({ ...prev, [key]: v }))
  const reset = () => onChange(Object.fromEntries(knobs.map(k => [k.key, k.value])))
  const dirty = knobs.some(k => values[k.key] !== k.value)
  return (
    <div className="ml-knobs">
      <div className="ml-knobs__head">
        <span className="ml-knobs__title">knobs</span>
        <button className="ml-knobs__reset" onClick={reset} disabled={!dirty} title="Restore this demo's default values">Reset defaults</button>
      </div>
      {knobs.map(k => {
        const v = values[k.key]
        const only = appliesTo(k.label)
        const inactive = only && activeVariant && !only.includes(activeVariant)
        const label = only ? k.label.replace(/\s*\([^)]*\)\s*$/, '') : k.label
        const scope = only ? <span className={`ml-knob__scope ${inactive ? 'is-off' : ''}`}>{inactive ? `only ${only.join(', ')} · not this variant` : `variant ${only.join(', ')}`}</span> : null
        const cls = `ml-knob ${inactive ? 'is-inactive' : ''}`
        if (k.type === 'ease') {
          return (
            <label key={k.key} className={cls}>
              <span className="ml-knob__label">{label}{scope}</span>
              <select value={v} onChange={e => set(k.key, e.target.value)}>
                {(k.options || EASE_OPTIONS).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          )
        }
        if (k.type === 'select') {
          return (
            <label key={k.key} className={cls}>
              <span className="ml-knob__label">{label}{scope}</span>
              <select value={v} onChange={e => set(k.key, e.target.value)}>
                {k.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          )
        }
        if (k.type === 'bool') {
          return (
            <label key={k.key} className={`${cls} ml-knob--row`}>
              <input type="checkbox" checked={!!v} onChange={e => set(k.key, e.target.checked)} />
              <span className="ml-knob__label">{label}{scope}</span>
            </label>
          )
        }
        return (
          <label key={k.key} className={cls}>
            <span className="ml-knob__label">
              <span>{label}{scope}</span>
              <em>{typeof v === 'number' ? (k.unit === 'ms' ? Math.round(v * 1000) + 'ms' : v.toFixed(k.digits ?? 2) + (k.unit || '')) : v}{v !== k.value && <i className="ml-knob__dot" title="changed from default" />}</em>
            </span>
            <input type="range" min={k.min} max={k.max} step={k.step} value={v} onChange={e => set(k.key, parseFloat(e.target.value))} />
          </label>
        )
      })}
    </div>
  )
}
