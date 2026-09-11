// Per-section configuration sheet.
//
// Opens when the user taps the gear on a section in edit mode. Each
// section type registers a tiny form here; types without configuration
// surface a "Nothing to configure" message.
//
// Forms write the full intended config object back to the draft via
// hubStore.updateSectionConfig — replace semantics, not merge.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useHubStore } from '../../stores/hubStore'
import { useAutomationStore } from '../../stores/automationStore'
import { getCameras } from '../../lib/api'

// ─── Shared form bits ────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
      {children}
      {hint && <span className="z-footnote">{hint}</span>}
    </label>
  )
}

// ─── Per-type forms ──────────────────────────────────────────────────────────

function WeatherForm({ config, onChange }) {
  return (
    <Field label="City" hint="Leave empty to use Settings → location.">
      <input className="z-input" value={config.city || ''}
             placeholder="Tel Aviv"
             onChange={e => onChange({ ...config, city: e.target.value })} />
    </Field>
  )
}

function CameraForm({ config, onChange }) {
  const [cameras, setCameras] = useState([])
  useEffect(() => {
    getCameras().then(r => setCameras(r.cameras || [])).catch(() => {})
  }, [])
  return (
    <>
      <Field label="Camera">
        <select className="z-input" value={config.entity_id || ''}
                onChange={e => onChange({ ...config, entity_id: e.target.value })}>
          <option value="">— pick a camera —</option>
          {cameras.map(c => (
            <option key={c.entity_id} value={c.entity_id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Refresh interval" hint="Snapshot poll rate. 4s is plenty for a hallway cam; 2s for an entry.">
        <select className="z-input" value={String(config.refresh_ms || 4000)}
                onChange={e => onChange({ ...config, refresh_ms: Number(e.target.value) })}>
          <option value="2000">2 seconds</option>
          <option value="4000">4 seconds</option>
          <option value="8000">8 seconds</option>
          <option value="15000">15 seconds</option>
        </select>
      </Field>
      <Field label="Label (optional)" hint="Defaults to the camera's name.">
        <input className="z-input" value={config.label || ''}
               placeholder=""
               onChange={e => onChange({ ...config, label: e.target.value })} />
      </Field>
    </>
  )
}

function LimitForm({ config, onChange, maxLimit = 20, label = 'Show items' }) {
  return (
    <Field label={label}>
      <input className="z-input" type="number" min="1" max={maxLimit}
             value={config.limit ?? ''}
             onChange={e => onChange({ ...config, limit: Number(e.target.value) || undefined })} />
    </Field>
  )
}

function CommandButtonForm({ config, onChange }) {
  const action = config.action || { kind: 'intent', intent: '', params: {} }
  const params = action.params || {}
  // Serialize/deserialize params to JSON so the user can edit shape freely.
  // Bad JSON keeps the draft string but doesn't update action.params until
  // it parses — we never silently drop their edits.
  const [paramsText, setParamsText] = useState(JSON.stringify(params, null, 2))
  const [paramsErr, setParamsErr]   = useState('')

  const onParamsBlur = () => {
    try {
      const parsed = paramsText.trim() ? JSON.parse(paramsText) : {}
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParamsErr('Params must be a JSON object.')
        return
      }
      setParamsErr('')
      onChange({ ...config, action: { ...action, params: parsed } })
    } catch (e) {
      setParamsErr('Invalid JSON.')
    }
  }

  return (
    <>
      <Field label="Button label" hint="Shown on the tile.">
        <input className="z-input" value={config.label || ''}
               placeholder="Turn off living room"
               onChange={e => onChange({ ...config, label: e.target.value })} />
      </Field>
      <Field label="Intent" hint="Ziggy intent name (e.g. turn_off_room, set_ac_temperature).">
        <input className="z-input z-code" value={action.intent || ''}
               placeholder="turn_off_room"
               onChange={e => onChange({ ...config, action: { ...action, kind: 'intent', intent: e.target.value } })} />
      </Field>
      <Field label="Params (JSON)" hint='e.g. {"room": "living_room"}'>
        <textarea
          className="z-input z-code"
          style={{ minHeight: 88, fontSize: 13, lineHeight: '18px', resize: 'vertical' }}
          value={paramsText}
          onChange={e => setParamsText(e.target.value)}
          onBlur={onParamsBlur}
        />
        {paramsErr && <span style={{ fontSize: 13, color: 'var(--err-text)' }}>{paramsErr}</span>}
      </Field>
    </>
  )
}

function SceneButtonForm({ config, onChange }) {
  const routines      = useAutomationStore(s => s.routines)
  const fetchRoutines = useAutomationStore(s => s.fetchRoutines)
  useEffect(() => { fetchRoutines({ maxAge: 60_000 }).catch(() => {}) }, [fetchRoutines])
  const action = config.action || { kind: 'routine', id: '' }
  return (
    <>
      <Field label="Routine">
        <select className="z-input" value={action.id || ''}
                onChange={e => onChange({ ...config, action: { kind: 'routine', id: e.target.value } })}>
          <option value="">— pick a routine —</option>
          {(routines || []).map(r => (
            <option key={r.id} value={r.id}>{r.label || r.id}</option>
          ))}
        </select>
      </Field>
      <Field label="Label override (optional)">
        <input className="z-input" value={config.label || ''}
               onChange={e => onChange({ ...config, label: e.target.value })} />
      </Field>
    </>
  )
}

// ─── Registry ────────────────────────────────────────────────────────────────

const FORMS = {
  weather_card:   WeatherForm,
  camera_tile:    CameraForm,
  tasks_list:     (p) => <LimitForm {...p} label="Tasks to show" />,
  alerts_inbox:   (p) => <LimitForm {...p} label="Alerts to show" maxLimit={20} />,
  scene_grid:     (p) => <LimitForm {...p} label="Scenes to show" maxLimit={24} />,
  command_button: CommandButtonForm,
  scene_button:   SceneButtonForm,
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

export function SectionConfigSheet({ section, onClose }) {
  const updateSectionConfig = useHubStore(s => s.updateSectionConfig)
  // Local draft so the user can cancel without affecting the layout draft.
  // Done writes through to the layout draft (which save commits to server).
  const [local, setLocal] = useState(section?.config || {})
  useEffect(() => { setLocal(section?.config || {}) }, [section?.id])

  if (!section) return null

  const Form = FORMS[section.type]
  const save = () => {
    updateSectionConfig(section.id, local)
    onClose()
  }

  return (
    <div className="z-hub-picker-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="z-hub-picker" onClick={e => e.stopPropagation()}>
        <div className="z-hub-picker-head">
          <div style={{ minWidth: 0 }}>
            <p className="z-eyebrow" style={{ margin: 0 }}>Configure</p>
            <p className="z-headline" style={{ margin: '2px 0 0' }}>{section.type.replace(/_/g, ' ')}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="z-hub-picker-close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
        <div className="z-hub-picker-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Form ? (
            <Form config={local} onChange={setLocal} />
          ) : (
            <p className="z-subhead" style={{ margin: 0 }}>
              This widget doesn't have any settings yet.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: 16, borderTop: '0.5px solid var(--line)' }}>
          <button onClick={onClose} className="z-btn-secondary">Cancel</button>
          <button onClick={save} className="z-btn-primary">Save</button>
        </div>
      </div>
    </div>
  )
}
