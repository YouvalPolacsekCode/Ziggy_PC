import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { IntentParamForm, validateIntentParams } from '../components/ui/IntentParamForm'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { sendDirectIntent } from '../lib/api'
import { useT } from '../lib/i18n'

// Curated list of useful intents — unchanged
const INTENT_OPTIONS = [
  { group: 'Lights — global', intents: [
    { value: 'turn_off_all_lights',       label: 'Turn off all lights' },
    { value: 'turn_off_everything',       label: 'Turn off everything (lights + media)' },
  ]},
  { group: 'Lights — room', intents: [
    { value: 'toggle_all_lights_in_room', label: 'Toggle all lights in room' },
    { value: 'toggle_light',              label: 'Toggle a single light' },
    { value: 'set_light_brightness',      label: 'Set brightness' },
    { value: 'set_light_color_temp',      label: 'Set color temperature' },
    { value: 'set_light_color',           label: 'Set RGB color' },
    { value: 'set_light_effect',          label: 'Set light effect' },
  ]},
  { group: 'Climate / AC', intents: [
    { value: 'report_all_temperatures',   label: 'All room temperatures' },
    { value: 'get_temperature',           label: 'Temperature in room' },
    { value: 'get_humidity',              label: 'Humidity in room' },
    { value: 'control_ac',               label: 'AC on/off' },
    { value: 'set_ac_temperature',        label: 'Set AC temperature' },
    { value: 'set_ac_mode',              label: 'Set AC mode' },
    { value: 'set_climate_fan_mode',      label: 'Set fan mode' },
    { value: 'set_climate_preset',        label: 'Set preset' },
  ]},
  { group: 'Media & TV', intents: [
    { value: 'control_tv',               label: 'TV on/off' },
    { value: 'set_tv_volume',            label: 'Set TV volume' },
    { value: 'tv_select_source',         label: 'Select TV source' },
    { value: 'media_play',               label: 'Play/resume' },
    { value: 'media_pause',              label: 'Pause' },
  ]},
  { group: 'Covers & Blinds', intents: [
    { value: 'open_cover',               label: 'Open cover' },
    { value: 'close_cover',              label: 'Close cover' },
    { value: 'set_cover_position',       label: 'Set cover position' },
  ]},
  { group: 'Presence & Status', intents: [
    { value: 'is_someone_home',           label: "Who's home?" },
    { value: 'list_active_devices',       label: 'List active devices' },
    { value: 'get_system_status',         label: 'System status' },
    { value: 'get_sun_times',             label: 'Sunrise / sunset times' },
  ]},
  { group: 'Tasks & Lists', intents: [
    { value: 'task_summary',              label: 'Task summary' },
    { value: 'list_tasks',               label: 'All tasks' },
    { value: 'get_shopping_list',         label: 'Shopping list' },
  ]},
  { group: 'Info & Web', intents: [
    { value: 'get_weather',               label: 'Weather' },
    { value: 'web_news_brief',            label: 'News brief' },
    { value: 'get_time',                  label: 'Current time' },
    { value: 'list_events',              label: 'Upcoming events' },
  ]},
]

const EMOJI_OPTIONS = ['💡', '🌡️', '👤', '✅', '🌙', '📋', '🌤️', '📰', '🔒', '🛋️', '🌀', '🎵', '⚙️', '📦', '🏠', '⚡', '🔔', '🛒']
const EMPTY_FORM   = { label: '', icon: '⚡', intent: 'turn_off_all_lights', params: {} }

// Kind label based on intent group
const KIND_LABEL = (intent) => {
  for (const g of INTENT_OPTIONS) {
    if (g.intents.some(i => i.value === intent)) {
      if (g.group.includes('Light'))    return { label: 'light',    tint: 'var(--warn)' }
      if (g.group.includes('Climate'))  return { label: 'climate',  tint: 'var(--info)' }
      if (g.group.includes('Media'))    return { label: 'media',    tint: 'var(--ok)' }
      if (g.group.includes('Cover'))    return { label: 'cover',    tint: 'var(--ink-mute)' }
      if (g.group.includes('Presence')) return { label: 'presence', tint: 'var(--ok)' }
      if (g.group.includes('Task'))     return { label: 'tasks',    tint: 'var(--accent)' }
      return { label: 'info', tint: 'var(--info)' }
    }
  }
  return { label: 'action', tint: 'var(--accent)' }
}

// ── Quick ask form ────────────────────────────────────────────────────────────
function QuickAskForm({ initial, onSave, onCancel, saving }) {
  const t = useT()
  const [form,        setForm]        = useState(initial || EMPTY_FORM)
  const [paramsError, setParamsError] = useState(null)

  const handleIntentChange = (e) => {
    setForm(f => ({ ...f, intent: e.target.value, params: {} }))
    setParamsError(null)
  }

  const validateAndSave = () => {
    const missing = validateIntentParams(form.intent, form.params || {})
    if (missing.length > 0) {
      setParamsError(t('quickAsks.requiredField', { fields: missing.join(', ') }))
      return
    }
    setParamsError(null)
    onSave({ label: form.label.trim(), icon: form.icon, intent: form.intent, params: form.params || {} })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Input label={t('quickAsks.labelField')} placeholder={t('quickAsks.labelPlaceholder')} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} autoFocus />

      {/* Icon picker */}
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>{t('quickAsks.icon')}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EMOJI_OPTIONS.map(e => (
            <button
              key={e} type="button"
              onClick={() => setForm(f => ({ ...f, icon: e }))}
              style={{
                width: 36, height: 36, borderRadius: 10, fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: form.icon === e ? `color-mix(in srgb, var(--accent) 12%, var(--surface))` : 'var(--bg-2)',
                border: form.icon === e ? '1.5px solid var(--accent)' : '0.5px solid var(--line)',
                cursor: 'pointer',
              }}
            >{e}</button>
          ))}
        </div>
      </div>

      {/* Intent picker */}
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>{t('quickAsks.intent')}</p>
        <select
          value={form.intent}
          onChange={handleIntentChange}
          className="z-input"
          style={{ height: 40, padding: '0 12px' }}
        >
          {INTENT_OPTIONS.map(({ group, intents }) => (
            <optgroup key={group} label={group}>
              {intents.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Params — structured form driven by intentParamSchema */}
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>{t('quickAsks.parameters')}</p>
        <IntentParamForm
          intent={form.intent}
          value={form.params || {}}
          onChange={params => { setParamsError(null); setForm(f => ({ ...f, params })) }}
          onError={setParamsError}
        />
        {paramsError && <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6 }}>{paramsError}</p>}
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button onClick={onCancel} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={validateAndSave} disabled={!form.label.trim() || saving} className="z-btn-primary" style={{ flex: 1 }}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function QuickAsks({ embedded = false }) {
  const t = useT()
  const { items, loading, fetch, create, update, remove } = useQuickAskStore()
  const { addToast } = useUIStore()
  const [showCreate, setShowCreate] = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [saving,     setSaving]     = useState(false)

  useEffect(() => { fetch() }, [])

  const handleCreate = async (data) => {
    setSaving(true)
    try { await create(data); addToast(t('quickAsks.added'), 'success'); setShowCreate(false) }
    catch (e) { addToast(e.message || t('common.failed'), 'error') }
    finally { setSaving(false) }
  }
  const handleUpdate = async (data) => {
    setSaving(true)
    try { await update(editing.id, data); addToast(t('quickAsks.updated'), 'success'); setEditing(null) }
    catch (e) { addToast(e.message || t('common.failed'), 'error') }
    finally { setSaving(false) }
  }
  const handleDelete = async (id) => {
    try { await remove(id); addToast(t('quickAsks.deleted'), 'success') }
    catch (e) { addToast(e.message || t('common.failed'), 'error') }
  }
  const handleFire = async (qa) => {
    try { await sendDirectIntent(qa.intent, qa.params || {}); addToast(qa.label, 'success') }
    catch (e) { addToast(e.message || t('quickAsks.failedFire'), 'error') }
  }

  return (
    <div style={embedded ? {} : { maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header — hidden when embedded in Settings */}
      {!embedded && (<div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('quickAsks.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('quickAsks.title')}</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4 }}>{t('quickAsks.tagline')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          {t('common.add')}
        </button>
      </div>)}

      {/* Embedded add button */}
      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={() => setShowCreate(true)} className="z-btn-primary" style={{ padding: '6px 12px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>+ {t('common.add')}</button>
        </div>
      )}

      {/* Loading — skeleton only on cold start; otherwise keep cached grid */}
      {loading && items.length === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {[1,2,3,4].map(i => <div key={i} style={{ height: 100, borderRadius: 13, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>⚡</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{t('quickAsks.noneTitle')}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>{t('quickAsks.noneHint')}</p>
          <button onClick={() => setShowCreate(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{t('quickAsks.addFirst')}</button>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <AnimatePresence>
          {items.map(qa => {
            const kind = KIND_LABEL(qa.intent)
            return (
              <motion.div
                key={qa.id}
                role="button"
                tabIndex={0}
                onClick={(e) => { if (e.target.closest('[data-qa-stop]')) return; handleFire(qa) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFire(qa) }}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                style={{
                  padding: '16px 16px', borderRadius: 13,
                  background: 'var(--surface)', border: '0.5px solid var(--line)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  gap: 10, minHeight: 120, cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 22 }}>{qa.icon || '⚡'}</span>
                  <span style={{
                    fontSize: 9, fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: kind.tint, fontWeight: 600,
                  }}>
                    {kind.label}
                  </span>
                </div>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 4 }}>
                    "{qa.label}"
                  </p>
                </div>
                <div data-qa-stop style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button onClick={() => setEditing({ ...qa, params: qa.params || {} })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => handleDelete(qa.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                  </button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('quickAsks.newTitle')}>
        <QuickAskForm onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={saving} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('quickAsks.editTitle')}>
        {editing && <QuickAskForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} saving={saving} />}
      </Modal>
    </div>
  )
}
