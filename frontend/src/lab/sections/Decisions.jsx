// Motion Lab — DECISIONS
// Everything the reviewer has picked, shortlisted or kept, with the knob
// values and notes. Inside the artifact these live in the shared db and are
// read back by Claude; elsewhere, Copy as JSON hands them over.
import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { subscribeDecisions, clearDecision, exportDecisions, saveGeneralNote, loadGeneralNote } from '../decisions'

const ORDER = ['navigation', 'cards', 'devices', 'rooms', 'controls', 'feedback', 'data', 'pages', 'moments', 'experimental']
const LABEL = { navigation: 'Navigation', cards: 'Cards', devices: 'Devices', rooms: 'Rooms', controls: 'Controls', feedback: 'Feedback', data: 'Data', pages: 'Page transitions', moments: 'Moments', experimental: 'Experimental' }

export default function Decisions() {
  const [map, setMap] = useState({})
  const [where, setWhere] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => subscribeDecisions((m, w) => { setMap(m); setWhere(w) }), [])
  const items = Object.values(map)
  const bySection = ORDER.map(s => [s, items.filter(i => i.section === s)]).filter(([, l]) => l.length)
  const counts = { pick: items.filter(i => i.verdict === 'pick').length, maybe: items.filter(i => i.verdict === 'maybe').length, reject: items.filter(i => i.verdict === 'reject').length }
  const [general, setGeneral] = useState('')
  const [generalSaved, setGeneralSaved] = useState(null)
  const gTimer = useRef(null)
  useEffect(() => { loadGeneralNote().then(n => { if (n?.text) setGeneral(n.text) }) }, [])
  const onGeneral = (v) => { setGeneral(v); clearTimeout(gTimer.current); gTimer.current = setTimeout(async () => { await saveGeneralNote(v); setGeneralSaved(new Date()) }, 900) }
  const copy = async () => { try { await navigator.clipboard.writeText(exportDecisions(map) + (general ? '\n\nGENERAL NOTES:\n' + general : '')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* no clipboard */ } }
  const counts2 = { note: items.filter(i => i.verdict === 'note').length }

  return (
    <div className="ml-overview">
      <div className="ml-section__intro">
        <h2>Decisions</h2>
        <p>Every demo has a Decide strip under its knobs. <strong>Pick this</strong> records the variant you are looking at with the knob values as you set them; <strong>Maybe</strong> shortlists it; <strong>Keep today</strong> means leave that interaction as it is. Notes are welcome ("combine B's ring with C's snap-back"). When you are done, tell Claude to read the decisions.</p>
        <p className="ml-note">
          {where === 'db' ? 'Saving to the shared lab database: Claude reads these directly.' : where === 'local' ? 'This copy has no shared database (dev server or LAN): decisions stay in this browser. Use Copy as JSON and paste it to Claude.' : 'Connecting…'}
        </p>
      </div>
      <div className="ml-general">
        <label htmlFor="general-notes" className="ml-h3" style={{ margin: '0 0 8px', display: 'block', fontSize: 15 }}>Notes to Claude</label>
        <textarea id="general-notes" className="ml-decide__note" rows={4} placeholder="Anything that is not about one demo: overall taste, what to combine, what to slow down, what felt wrong on the phone…" value={general} onChange={e => onGeneral(e.target.value)} onBlur={async () => { clearTimeout(gTimer.current); await saveGeneralNote(general); setGeneralSaved(new Date()) }} style={{ resize: 'vertical', minHeight: 90 }} />
        <div className="ml-decide__status">{generalSaved ? `Saved ${generalSaved.toLocaleTimeString()}` : general ? 'Saving…' : 'Saves automatically'}</div>
      </div>
      <div className="ml-decisions__bar">
        <span className="ml-decisions__count"><strong>{counts.pick}</strong> picked · <strong>{counts.maybe}</strong> maybe · <strong>{counts.reject}</strong> keep today · <strong>{counts2.note}</strong> note only · {Math.max(0, 50 - items.length)} undecided</span>
        <button className="ml-btn" onClick={copy}>{copied ? 'Copied' : 'Copy as JSON'}</button>
      </div>
      {items.length === 0 && <p className="ml-note" style={{ marginTop: 16 }}>Nothing decided yet. Start with <Link to="/navigation" style={{ color: 'var(--ml-accent)' }}>Navigation</Link>.</p>}
      {bySection.map(([s, list]) => (
        <div key={s} style={{ marginTop: 22 }}>
          <h3 className="ml-h3" style={{ marginTop: 0 }}><Link to={`/${s}`} style={{ color: 'inherit', textDecoration: 'none' }}>{LABEL[s] || s}</Link></h3>
          <div className="ml-findings">
            {list.sort((a, b) => a.title.localeCompare(b.title)).map(d => (
              <div key={d.demo} className={`ml-finding ml-decision is-${d.verdict}`}>
                <div className="ml-decision__head">
                  <strong><Link to={`/${d.section}#${d.demo}`} style={{ color: 'inherit', textDecoration: 'none' }}>{d.title}</Link></strong>
                  <span className={`ml-decision__verdict is-${d.verdict}`}>{d.verdict === 'pick' ? `★ ${d.variant} · ${d.variantLabel}` : d.verdict === 'maybe' ? `maybe · ${d.variant} ${d.variantLabel || ''}` : d.verdict === 'note' ? `note · viewing ${d.variant || '–'}` : 'keep today'}</span>
                </div>
                {d.knobs && Object.keys(d.knobs).length > 0 && <div className="ml-decision__knobs">{Object.entries(d.knobs).map(([k, v]) => <span key={k}>{k} <em>{typeof v === 'number' ? (v < 5 && !Number.isInteger(v) ? v.toFixed(2) : v) : String(v)}</em></span>)}</div>}
                {d.note && <p>{d.note}</p>}
                <div className="ml-decision__foot"><span>{new Date(d.updatedAt).toLocaleString()}</span><button className="ml-decide__clear" onClick={() => clearDecision(d.demo)} title="Clear">×</button></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
