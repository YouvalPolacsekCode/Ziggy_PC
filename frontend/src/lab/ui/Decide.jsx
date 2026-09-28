// Motion Lab — the Decide strip under every demo's knobs.
// Pick this variant (with the knob values as set) · Maybe · Keep today.
// Writes to the artifact db when inside the viewer, else localStorage.
import { useEffect, useState, useRef } from 'react'
import { saveDecision, clearDecision, loadDecision, subscribeDecisions } from '../decisions'

const VERDICTS = [
  { key: 'pick', label: 'Pick this', hint: 'Use this variant, with the knobs as set' },
  { key: 'maybe', label: 'Maybe', hint: 'Shortlist; decide later' },
  { key: 'reject', label: 'Keep today', hint: 'Do not change this interaction' },
]

export function Decide({ demoId, section, title, variant, knobs }) {
  const [saved, setSaved] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [where, setWhere] = useState(null)
  const noteTimer = useRef(null)

  useEffect(() => {
    let alive = true
    loadDecision(demoId).then(d => { if (alive && d) { setSaved(d); setNote(d.note || '') } })
    const unsub = subscribeDecisions((map, w) => { if (!alive) return; setWhere(w); const d = map[demoId]; if (d) { setSaved(d); setNote(n => n === (d.note || '') ? n : (d.note || n)) } else setSaved(null) })
    return () => { alive = false; unsub() }
  }, [demoId])

  const commit = async (verdict, noteText = note) => {
    setBusy(true)
    try {
      const r = await saveDecision(demoId, { section, title, verdict, variant: variant?.key || null, variantLabel: variant?.label || null, knobs, note: noteText })
      setWhere(r.where)
    } finally { setBusy(false) }
  }
  // A note saves on its own: without a verdict it is stored as verdict 'note'.
  const onNote = (v) => {
    setNote(v)
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => { if (v.trim() || saved) commit(saved?.verdict || 'note', v) }, 800)
  }
  const current = saved?.verdict
  const pickedThis = current === 'pick' && saved?.variant === variant?.key

  return (
    <div className="ml-decide">
      <div className="ml-decide__row">
        {VERDICTS.map(v => {
          const on = current === v.key && (v.key !== 'pick' || pickedThis)
          return <button key={v.key} className={`ml-decide__btn is-${v.key} ${on ? 'is-on' : ''}`} title={v.hint} disabled={busy} onClick={() => commit(v.key)}>{v.key === 'pick' ? `★ ${v.label} (${variant?.key ?? '–'})` : v.label}</button>
        })}
        {saved && <button className="ml-decide__clear" title="Clear this decision" onClick={() => clearDecision(demoId)}>×</button>}
      </div>
      <input id={`note-${demoId}`} className="ml-decide__note" placeholder="Add a note for Claude (combine with…, slower, only on phone…)" value={note} onChange={e => onNote(e.target.value)} onBlur={() => { clearTimeout(noteTimer.current); if (note.trim() || saved) commit(saved?.verdict || 'note', note) }} />
      <div className="ml-decide__status">
        {saved ? (
          <>Saved · <strong>{saved.verdict === 'pick' ? `pick ${saved.variant}` : saved.verdict === 'maybe' ? 'maybe' : saved.verdict === 'note' ? 'note only' : 'keep today'}</strong>{saved.verdict === 'pick' && saved.variant !== variant?.key ? ` (you are viewing ${variant?.key})` : ''}{where === 'local' ? ' · this browser only' : ''}</>
        ) : <>Not decided{where === 'local' ? ' · saves to this browser (export from Decisions)' : ''}</>}
      </div>
    </div>
  )
}
