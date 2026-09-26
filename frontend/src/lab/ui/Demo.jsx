// Motion Lab — the frame every prototype sits in.
//
//   <Demo
//     id="nav-active"
//     title="Nav active state"
//     purpose="Which item is current, and that it MOVED there."
//     inZiggy={['BottomNav.jsx', 'Sidebar.jsx']}
//     knobs={[{ key: 'duration', label: 'Duration', min: 0.1, max: 1, step: 0.02, value: 0.32, unit: 's' }]}
//     variants={[
//       { key: 'A', label: 'Sliding pill', note: '…', render: (p) => <NavPill {...p} /> },
//     ]}
//   />
//
// `render` receives { knobs, replayKey, rtl, reduced, speed, tx, stage }.
// Replay remounts the variant (fresh initial state). Knobs are per-demo.
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useLab } from '../LabContext'
import { Stage } from './Stage'
import { Knobs } from './Knobs'

export function Demo({ id, title, purpose, inZiggy = [], variants = [], knobs = [], stage = 'phone', height, wide = false, children, recommend }) {
  const lab = useLab()
  const [variantKey, setVariantKey] = useState(variants[0]?.key)
  const [replayKey, setReplayKey] = useState(0)
  const [knobValues, setKnobValues] = useState(() => Object.fromEntries(knobs.map(k => [k.key, k.value])))

  // keep knob defaults in sync if the knob list changes
  useEffect(() => {
    setKnobValues(prev => {
      const next = { ...prev }
      for (const k of knobs) if (!(k.key in next)) next[k.key] = k.value
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knobs.map(k => k.key).join('|')])

  const variant = variants.find(v => v.key === variantKey) || variants[0]
  const replay = useCallback(() => setReplayKey(k => k + 1), [])

  const props = useMemo(() => ({
    knobs: knobValues,
    replayKey,
    replay,
    rtl: lab.rtl,
    reduced: lab.reduced,
    speed: lab.speed,
    tx: lab.tx,
    ms: lab.ms,
    stage,
  }), [knobValues, replayKey, replay, lab.rtl, lab.reduced, lab.speed, lab.tx, lab.ms, stage])

  return (
    <section className={`ml-demo ${wide ? 'ml-demo--wide' : ''}`} id={id} data-demo={id}>
      <header className="ml-demo__head">
        <div className="ml-demo__titles">
          <h3 className="ml-demo__title">{title}</h3>
          {purpose && <p className="ml-demo__purpose">{purpose}</p>}
          {inZiggy.length > 0 && (
            <p className="ml-demo__where">
              <span className="ml-tag">In Ziggy</span>
              {inZiggy.map((w, i) => <code key={i}>{w}</code>)}
            </p>
          )}
        </div>
        <div className="ml-demo__actions">
          <button className="ml-btn" onClick={replay} title="Remount the prototype in its initial state">↻ Replay</button>
        </div>
      </header>

      {variants.length > 1 && (
        <div className="ml-variants" role="tablist" aria-label="Variants">
          {variants.map(v => (
            <button
              key={v.key}
              role="tab"
              aria-selected={v.key === variant?.key}
              className={`ml-variant ${v.key === variant?.key ? 'is-active' : ''} ${recommend === v.key ? 'is-rec' : ''}`}
              onClick={() => { setVariantKey(v.key); setReplayKey(k => k + 1) }}
            >
              <span className="ml-variant__key">{v.key}</span>
              <span className="ml-variant__label">{v.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ml-demo__body">
        <Stage kind={stage} height={height}>
          {variant ? (
            <div key={`${variant.key}-${replayKey}`} className="ml-stage__content" dir={lab.dir}>
              {variant.render(props)}
            </div>
          ) : (
            <div key={replayKey} className="ml-stage__content" dir={lab.dir}>
              {typeof children === 'function' ? children(props) : children}
            </div>
          )}
        </Stage>
        <aside className="ml-demo__side">
          {variant?.note && <p className="ml-note">{variant.note}</p>}
          {variant?.tradeoff && <p className="ml-note ml-note--tradeoff"><strong>Trade-off.</strong> {variant.tradeoff}</p>}
          {knobs.length > 0 && <Knobs knobs={knobs} values={knobValues} onChange={setKnobValues} />}
        </aside>
      </div>
    </section>
  )
}
