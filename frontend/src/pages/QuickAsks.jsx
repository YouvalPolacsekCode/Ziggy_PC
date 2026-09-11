import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { IntentParamForm, validateIntentParams } from '../components/ui/IntentParamForm'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { sendDirectIntent } from '../lib/api'
import { useT, useLang, translateNamePhrase } from '../lib/i18n'
import { T_ENTER } from '../lib/motion'
import { fieldLabelStyle, cardIconBtn } from '../lib/automations/styles'

// Curated list of useful intents. Each group has a stable `kind` so the
// chip label logic doesn't depend on the (now-translated) group label string.
function getIntentOptions(t) {
  return [
    { kind: 'lights_global', group: t('quickAsks.group.lightsGlobal'), intents: [
      { value: 'turn_off_all_lights',       label: t('quickAsks.intent.turn_off_all_lights') },
      { value: 'turn_off_everything',       label: t('quickAsks.intent.turn_off_everything') },
    ]},
    { kind: 'lights_room', group: t('quickAsks.group.lightsRoom'), intents: [
      { value: 'toggle_all_lights_in_room', label: t('quickAsks.intent.toggle_all_lights_in_room') },
      { value: 'toggle_light',              label: t('quickAsks.intent.toggle_light') },
      { value: 'set_light_brightness',      label: t('quickAsks.intent.set_light_brightness') },
      { value: 'set_light_color_temp',      label: t('quickAsks.intent.set_light_color_temp') },
      { value: 'set_light_color',           label: t('quickAsks.intent.set_light_color') },
      { value: 'set_light_effect',          label: t('quickAsks.intent.set_light_effect') },
    ]},
    { kind: 'climate', group: t('quickAsks.group.climate'), intents: [
      { value: 'report_all_temperatures',   label: t('quickAsks.intent.report_all_temperatures') },
      { value: 'get_temperature',           label: t('quickAsks.intent.get_temperature') },
      { value: 'get_humidity',              label: t('quickAsks.intent.get_humidity') },
      { value: 'control_ac',                label: t('quickAsks.intent.control_ac') },
      { value: 'set_ac_temperature',        label: t('quickAsks.intent.set_ac_temperature') },
      { value: 'set_ac_mode',               label: t('quickAsks.intent.set_ac_mode') },
      { value: 'set_climate_fan_mode',      label: t('quickAsks.intent.set_climate_fan_mode') },
      { value: 'set_climate_preset',        label: t('quickAsks.intent.set_climate_preset') },
    ]},
    { kind: 'media', group: t('quickAsks.group.media'), intents: [
      { value: 'control_tv',                label: t('quickAsks.intent.control_tv') },
      { value: 'set_tv_volume',             label: t('quickAsks.intent.set_tv_volume') },
      { value: 'tv_select_source',          label: t('quickAsks.intent.tv_select_source') },
      { value: 'media_play',                label: t('quickAsks.intent.media_play') },
      { value: 'media_pause',               label: t('quickAsks.intent.media_pause') },
    ]},
    { kind: 'cover', group: t('quickAsks.group.covers'), intents: [
      { value: 'open_cover',                label: t('quickAsks.intent.open_cover') },
      { value: 'close_cover',               label: t('quickAsks.intent.close_cover') },
      { value: 'set_cover_position',        label: t('quickAsks.intent.set_cover_position') },
    ]},
    { kind: 'presence', group: t('quickAsks.group.presence'), intents: [
      { value: 'is_someone_home',           label: t('quickAsks.intent.is_someone_home') },
      { value: 'list_active_devices',       label: t('quickAsks.intent.list_active_devices') },
      { value: 'get_system_status',         label: t('quickAsks.intent.get_system_status') },
      { value: 'get_sun_times',             label: t('quickAsks.intent.get_sun_times') },
    ]},
    { kind: 'tasks', group: t('quickAsks.group.tasks'), intents: [
      { value: 'task_summary',              label: t('quickAsks.intent.task_summary') },
      { value: 'list_tasks',                label: t('quickAsks.intent.list_tasks') },
      { value: 'get_shopping_list',         label: t('quickAsks.intent.get_shopping_list') },
    ]},
    { kind: 'info', group: t('quickAsks.group.info'), intents: [
      { value: 'get_weather',               label: t('quickAsks.intent.get_weather') },
      { value: 'web_news_brief',            label: t('quickAsks.intent.web_news_brief') },
      { value: 'get_time',                  label: t('quickAsks.intent.get_time') },
      { value: 'list_events',               label: t('quickAsks.intent.list_events') },
    ]},
  ]
}

// Stable intent→kind map. Built once at module load so getKindLabel stays
// cheap and works without a translator (e.g. for sort orderings).
const INTENT_KIND = (() => {
  const map = new Map()
  for (const g of getIntentOptions((k) => k)) {
    for (const it of g.intents) map.set(it.value, g.kind)
  }
  return map
})()

const KIND_LABEL_KEY = {
  lights_global: 'quickAsks.kind.light',
  lights_room:   'quickAsks.kind.light',
  climate:       'quickAsks.kind.climate',
  media:         'quickAsks.kind.media',
  cover:         'quickAsks.kind.cover',
  presence:      'quickAsks.kind.presence',
  tasks:         'quickAsks.kind.tasks',
  info:          'quickAsks.kind.info',
}

// The emoji here is the person's chosen identity for their own quick ask —
// user content, so it stays. Only the UI's own glyphs became line icons.
const EMOJI_OPTIONS = ['💡', '🌡️', '👤', '✅', '🌙', '📋', '🌤️', '📰', '🔒', '🛋️', '🌀', '🎵', '⚙️', '📦', '🏠', '⚡', '🔔', '🛒']
const EMPTY_FORM   = { label: '', icon: '⚡', intent: 'turn_off_all_lights', params: {} }

// Kind label for the chip — resolved against the active i18n table. One
// neutral chip; the per-kind tint (which spent the accent on "tasks") is gone.
function getKindLabel(intent, t) {
  const kind = INTENT_KIND.get(intent)
  if (!kind) return t('quickAsks.kind.action')
  return t(KIND_LABEL_KEY[kind])
}

// ── Quick ask form ────────────────────────────────────────────────────────────
function QuickAskForm({ initial, onSave, onCancel, saving }) {
  const t = useT()
  const intentOptions = getIntentOptions(t)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Input label={t('quickAsks.labelField')} placeholder={t('quickAsks.labelPlaceholder')} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} autoFocus dir="auto" />

      {/* Icon picker — 44px targets; the chosen one is ink-outlined, not accent. */}
      <div>
        <p style={{ ...fieldLabelStyle, marginBottom: 8 }}>{t('quickAsks.icon')}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EMOJI_OPTIONS.map(e => (
            <button
              key={e} type="button"
              onClick={() => setForm(f => ({ ...f, icon: e }))}
              aria-pressed={form.icon === e}
              aria-label={e}
              style={{
                width: 40, height: 40, borderRadius: 'var(--r-ctl)', fontSize: 18, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: form.icon === e ? 'var(--surface-2)' : 'var(--surface)',
                border: form.icon === e ? '1.5px solid var(--ink)' : '0.5px solid var(--line)',
                cursor: 'pointer',
                transition: 'background var(--dur-press) var(--ease-standard), border-color var(--dur-press) var(--ease-standard)',
              }}
            >{e}</button>
          ))}
        </div>
      </div>

      {/* Intent picker */}
      <div>
        <p style={{ ...fieldLabelStyle, marginBottom: 8 }}>{t('quickAsks.intent')}</p>
        <select
          value={form.intent}
          onChange={handleIntentChange}
          className="z-input"
          aria-label={t('quickAsks.intent')}
        >
          {intentOptions.map(({ kind, group, intents }) => (
            <optgroup key={kind} label={group}>
              {intents.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Params — structured form driven by intentParamSchema */}
      <div>
        <p style={{ ...fieldLabelStyle, marginBottom: 8 }}>{t('quickAsks.parameters')}</p>
        <IntentParamForm
          intent={form.intent}
          value={form.params || {}}
          onChange={params => { setParamsError(null); setForm(f => ({ ...f, params })) }}
          onError={setParamsError}
        />
        {paramsError && <p className="z-footnote" role="alert" style={{ color: 'var(--err-text)', marginTop: 8 }}>{paramsError}</p>}
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button onClick={onCancel} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={validateAndSave} disabled={!form.label.trim() || saving} className="z-btn-primary" style={{ flex: 1, opacity: (!form.label.trim() || saving) ? 0.5 : 1 }}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function QuickAsks({ embedded = false }) {
  const t = useT()
  const lang = useLang()
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
    try { await sendDirectIntent(qa.intent, qa.params || {}); addToast(translateNamePhrase(qa.label, lang), 'success') }
    catch (e) { addToast(e.message || t('quickAsks.failedFire'), 'error') }
  }

  return (
    <div style={embedded ? {} : { maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>
      {/* Header — hidden when embedded in Settings. ONE trailing primary: the
          44×44 "+" (the tagline is the Subhead under the title). */}
      {!embedded && (<div className="z-page-head">
        <div>
          <p className="z-eyebrow">{t('quickAsks.eyebrow')}</p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('quickAsks.title')}</h1>
          <p className="z-subhead" style={{ marginTop: 4 }}>{t('quickAsks.tagline')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="z-btn-primary" aria-label={t('quickAsks.newTitle')} title={t('quickAsks.newTitle')} style={{ width: 40, height: 40, padding: 0, flexShrink: 0 }}>
          <Plus size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>)}

      {/* Embedded add button — the one primary of the embedded panel. */}
      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={() => setShowCreate(true)} className="z-btn-primary">
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
            {t('common.add')}
          </button>
        </div>
      )}

      {/* Loading — skeleton only on cold start; otherwise keep cached grid */}
      {loading && items.length === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {[1,2,3,4].map(i => <div key={i} style={{ height: 120, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p className="z-headline" style={{ margin: '0 0 4px' }}>{t('quickAsks.noneTitle')}</p>
          <p className="z-subhead" style={{ margin: '0 0 16px' }}>{t('quickAsks.noneHint')}</p>
          <button onClick={() => setShowCreate(true)} className="z-btn-secondary">{t('quickAsks.addFirst')}</button>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <AnimatePresence>
          {items.map(qa => {
            const kindLabel = getKindLabel(qa.intent, t)
            return (
              <motion.div
                key={qa.id}
                role="button"
                tabIndex={0}
                onClick={(e) => { if (e.target.closest('[data-qa-stop]')) return; handleFire(qa) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFire(qa) }}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                transition={T_ENTER}
                style={{
                  padding: 12, borderRadius: 'var(--r-card)',
                  background: 'var(--surface)', border: '0.5px solid var(--line)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  gap: 12, minHeight: 120, cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">{qa.icon || '⚡'}</span>
                  <span className="z-chip">{kindLabel}</span>
                </div>
                <p dir="auto" className="z-body" style={{ fontWeight: 500, margin: 0 }}>
                  “{translateNamePhrase(qa.label, lang)}”
                </p>
                <div data-qa-stop style={{ display: 'flex', gap: 0, justifyContent: 'flex-end', margin: '-8px -12px -12px 0' }}>
                  <button onClick={() => setEditing({ ...qa, params: qa.params || {} })} aria-label={t('common.edit')} title={t('common.edit')} style={cardIconBtn()}>
                    <Pencil size={18} strokeWidth={1.75} />
                  </button>
                  <button onClick={() => handleDelete(qa.id)} aria-label={t('common.delete')} title={t('common.delete')} style={cardIconBtn('var(--err-text)')}>
                    <Trash2 size={18} strokeWidth={1.75} />
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
