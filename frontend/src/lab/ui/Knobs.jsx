// Motion Lab — per-demo knobs (duration, bounce, stiffness, easing…).
import { EASE_OPTIONS } from '../time'

export function Knobs({ knobs, values, onChange }) {
  const set = (key, v) => onChange(prev => ({ ...prev, [key]: v }))
  return (
    <div className="ml-knobs">
      {knobs.map(k => {
        const v = values[k.key]
        if (k.type === 'ease') {
          return (
            <label key={k.key} className="ml-knob">
              <span className="ml-knob__label">{k.label}</span>
              <select value={v} onChange={e => set(k.key, e.target.value)}>
                {(k.options || EASE_OPTIONS).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          )
        }
        if (k.type === 'select') {
          return (
            <label key={k.key} className="ml-knob">
              <span className="ml-knob__label">{k.label}</span>
              <select value={v} onChange={e => set(k.key, e.target.value)}>
                {k.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          )
        }
        if (k.type === 'bool') {
          return (
            <label key={k.key} className="ml-knob ml-knob--row">
              <input type="checkbox" checked={!!v} onChange={e => set(k.key, e.target.checked)} />
              <span className="ml-knob__label">{k.label}</span>
            </label>
          )
        }
        return (
          <label key={k.key} className="ml-knob">
            <span className="ml-knob__label">
              {k.label}
              <em>{typeof v === 'number' ? (k.unit === 'ms' ? Math.round(v * 1000) + 'ms' : v.toFixed(k.digits ?? 2) + (k.unit || '')) : v}</em>
            </span>
            <input
              type="range"
              min={k.min} max={k.max} step={k.step}
              value={v}
              onChange={e => set(k.key, parseFloat(e.target.value))}
            />
          </label>
        )
      })}
    </div>
  )
}
