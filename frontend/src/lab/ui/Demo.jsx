// Motion Lab — the frame every prototype sits in.
//
//   <Demo
//     id="nav-active"
//     title="Nav active state"
//     purpose="Which item is current, and that it MOVED there."
//     principles={['continuity', 'hierarchy']}
//     inZiggy={['BottomNav.jsx', 'Sidebar.jsx']}
//     knobs={[{ key: 'duration', label: 'Duration', min: 0.1, max: 1, step: 0.02, value: 0.32, unit: 'ms' }]}
//     variants={[
//       { key: 'A', label: 'Sliding pill', note: '…', spec: (k) => `spring ${k.duration}s`, render: (p) => <NavPill {...p} /> },
//     ]}
//     recommend="C"
//   />
//
// `render` receives { knobs, replayKey, replay, rtl, reduced, speed, tx, ms, stage }.
// Replay remounts the variant. "Compare" shows variant A ("today") beside the
// selected one so a decision can be made by feel, on the same stage size.
import { useMemo, useState, useCallback, useEffect } from 'react'
import { motion, LayoutGroup } from 'framer-motion'
import { useLab } from '../LabContext'
import { Stage } from './Stage'
import { Knobs } from './Knobs'
import { Decide } from './Decide'

export const PRINCIPLES = {
  continuity: { label: 'Continuity', hint: 'the thing you touched is the thing that moves' },
  causality: { label: 'Causality', hint: 'effects follow causes, in order' },
  hierarchy: { label: 'Hierarchy', hint: 'importance has weight' },
  state: { label: 'State', hint: 'a change is an event, not a swap' },
  physical: { label: 'Physical', hint: 'places, springs, mass, velocity' },
  restraint: { label: 'Restraint', hint: 'frequent = quiet' },
}

function sectionFromPath() {
  try { const m = (window.location.hash || window.location.pathname).match(/\/(navigation|cards|devices|rooms|controls|feedback|data|pages|moments|experimental)\b/); return m ? m[1] : 'unknown' } catch { return 'unknown' }
}

function fmtSpec(knobs) {
  const parts = []
  if (typeof knobs.duration === 'number') parts.push(`${Math.round(knobs.duration * 1000)} ms`)
  if (typeof knobs.bounce === 'number') parts.push(`bounce ${knobs.bounce.toFixed(2)}`)
  if (typeof knobs.ease === 'string') parts.push(`ease ${knobs.ease}`)
  if (typeof knobs.stagger === 'number') parts.push(`stagger ${Math.round(knobs.stagger * 1000)} ms`)
  return parts.join(' · ')
}

export function Demo({ id, title, purpose, principles = [], inZiggy = [], variants = [], knobs = [], stage = 'phone', height, wide = false, children, recommend, section, bare = false, activeNav }) {
  const lab = useLab()
  const [variantKey, setVariantKey] = useState(variants[0]?.key)
  const [replayKey, setReplayKey] = useState(0)
  const [compare, setCompare] = useState(false)
  const [knobValues, setKnobValues] = useState(() => Object.fromEntries(knobs.map(k => [k.key, k.value])))

  useEffect(() => {
    setKnobValues(prev => {
      const next = { ...prev }
      for (const k of knobs) if (!(k.key in next)) next[k.key] = k.value
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knobs.map(k => k.key).join('|')])

  const variant = variants.find(v => v.key === variantKey) || variants[0]
  const baseline = variants[0]
  const canCompare = variants.length > 1 && variant?.key !== baseline?.key
  const replay = useCallback(() => setReplayKey(k => k + 1), [])

  const props = useMemo(() => ({
    knobs: knobValues, replayKey, replay,
    rtl: lab.rtl, reduced: lab.reduced, speed: lab.speed, tx: lab.tx, ms: lab.ms, stage,
  }), [knobValues, replayKey, replay, lab.rtl, lab.reduced, lab.speed, lab.tx, lab.ms, stage])

  const spec = variant?.spec ? variant.spec(knobValues) : fmtSpec(knobValues)

  const renderStage = (v, key) => (
    <Stage kind={stage} height={height} bare={bare} activeNav={activeNav}>
      <div key={`${v.key}-${key}`} className="ml-stage__content" dir={lab.dir}>
        {v.render(props)}
      </div>
    </Stage>
  )

  return (
    <section className={`ml-demo ${wide ? 'ml-demo--wide' : ''} ${compare && canCompare ? 'ml-demo--compare' : ''}`} id={id} data-demo={id}>
      <header className="ml-demo__head">
        <div className="ml-demo__titles">
          <h3 className="ml-demo__title">{title}</h3>
          {purpose && <p className="ml-demo__purpose">{purpose}</p>}
          <p className="ml-demo__where">
            {principles.map(p => PRINCIPLES[p] && <span key={p} className="ml-principle" title={PRINCIPLES[p].hint}>{PRINCIPLES[p].label}</span>)}
            {inZiggy.length > 0 && <span className="ml-tag">In Ziggy</span>}
            {inZiggy.map((w, i) => <code key={i}>{w}</code>)}
          </p>
        </div>
        <div className="ml-demo__actions">
          {canCompare && <button className={`ml-btn ${compare ? 'is-on' : ''}`} onClick={() => setCompare(c => !c)} title="Show variant A (today) beside this one">⇄ Compare</button>}
          <button className="ml-btn" onClick={replay} title="Remount the prototype in its initial state">↻ Replay</button>
        </div>
      </header>

      {variants.length > 1 && (
        <LayoutGroup id={`variants-${id}`}>
          <div className="ml-variants" role="tablist" aria-label="Variants">
            {variants.map(v => {
              const active = v.key === variant?.key
              return (
                <button key={v.key} role="tab" aria-selected={active}
                  className={`ml-variant ${active ? 'is-active' : ''} ${recommend === v.key ? 'is-rec' : ''}`}
                  onClick={() => { setVariantKey(v.key); setReplayKey(k => k + 1) }}>
                  {active && <motion.span layoutId={`variant-pill-${id}`} className="ml-variant__bg" transition={{ type: 'spring', duration: 0.42, bounce: 0.12 }} />}
                  <span className="ml-variant__key">{v.key}</span>
                  <span className="ml-variant__label">{v.label}</span>
                </button>
              )
            })}
          </div>
        </LayoutGroup>
      )}

      <div className="ml-demo__body">
        {compare && canCompare ? (
          <div className="ml-compare">
            <div className="ml-compare__col"><div className="ml-compare__label">A · {baseline.label}</div>{renderStage(baseline, replayKey)}</div>
            <div className="ml-compare__col"><div className="ml-compare__label">{variant.key} · {variant.label}</div>{renderStage(variant, replayKey)}</div>
          </div>
        ) : variant ? renderStage(variant, replayKey) : (
          <Stage kind={stage} height={height} bare={bare} activeNav={activeNav}>
            <div key={replayKey} className="ml-stage__content" dir={lab.dir}>{typeof children === 'function' ? children(props) : children}</div>
          </Stage>
        )}
        <aside className="ml-demo__side">
          {variant?.note && <p className="ml-note">{variant.note}</p>}
          {variant?.tradeoff && <p className="ml-note ml-note--tradeoff"><strong>Trade-off.</strong> {variant.tradeoff}</p>}
          {spec && <div className="ml-spec"><span className="ml-spec__label">spec</span>{spec}</div>}
          {knobs.length > 0 && <Knobs knobs={knobs} values={knobValues} onChange={setKnobValues} />}
          <Decide demoId={id} section={section || sectionFromPath()} title={title} variant={variant} knobs={knobValues} />
        </aside>
      </div>
    </section>
  )
}
