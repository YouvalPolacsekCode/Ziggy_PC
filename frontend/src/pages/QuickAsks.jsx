import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Pencil, GripVertical } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/utils'

// Curated list of useful no-or-simple-param intents for quick asks
const INTENT_OPTIONS = [
  { group: 'Lights', intents: [
    { value: 'turn_off_all_lights',      label: 'Turn off all lights' },
    { value: 'toggle_all_lights_in_room', label: 'All lights in room (requires room param)' },
    { value: 'toggle_light',             label: 'Single light (requires room param)' },
  ]},
  { group: 'Climate', intents: [
    { value: 'report_all_temperatures',  label: 'All temperatures' },
    { value: 'get_temperature',          label: 'Temperature in room (requires room param)' },
    { value: 'get_humidity',             label: 'Humidity in room (requires room param)' },
  ]},
  { group: 'Devices', intents: [
    { value: 'turn_off_everything',      label: 'Turn off everything (lights + TV)' },
    { value: 'control_tv',               label: 'TV on/off' },
    { value: 'control_ac',               label: 'AC on/off (requires room param)' },
  ]},
  { group: 'Presence & Status', intents: [
    { value: 'is_someone_home',          label: "Who's home?" },
    { value: 'get_system_status',        label: 'System status' },
    { value: 'get_sun_times',            label: 'Sunrise / sunset times' },
  ]},
  { group: 'Tasks & Lists', intents: [
    { value: 'task_summary',             label: 'Task summary' },
    { value: 'list_tasks',               label: 'All tasks' },
    { value: 'get_shopping_list',        label: 'Shopping list' },
  ]},
  { group: 'Info', intents: [
    { value: 'get_weather',              label: 'Weather (requires city param)' },
    { value: 'web_news_brief',           label: 'News brief' },
    { value: 'get_time',                 label: 'Current time' },
    { value: 'list_events',              label: 'Upcoming events' },
  ]},
]

const EMOJI_OPTIONS = ['💡', '🌡️', '👤', '✅', '🌙', '📋', '🌤️', '📰', '🔒', '🛋️', '🌀', '🎵', '⚙️', '📦', '🏠', '⚡', '🔔', '🛒']

const EMPTY_FORM = { label: '', icon: '⚡', intent: 'turn_off_all_lights', params: '{}' }

function QuickAskForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [paramsError, setParamsError] = useState(null)

  const validateAndSave = () => {
    try {
      const params = JSON.parse(form.params || '{}')
      setParamsError(null)
      onSave({ label: form.label.trim(), icon: form.icon, intent: form.intent, params })
    } catch {
      setParamsError('Invalid JSON — check params syntax')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Label */}
      <Input
        label="Label"
        placeholder="e.g. Turn off all lights"
        value={form.label}
        onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        autoFocus
      />

      {/* Icon picker */}
      <div>
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Icon</p>
        <div className="flex flex-wrap gap-2">
          {EMOJI_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setForm((f) => ({ ...f, icon: e }))}
              className={cn(
                'w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all',
                form.icon === e
                  ? 'bg-violet-100 dark:bg-violet-900/40 ring-2 ring-violet-500'
                  : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Intent picker */}
      <div>
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Intent</p>
        <select
          value={form.intent}
          onChange={(e) => setForm((f) => ({ ...f, intent: e.target.value }))}
          className="w-full h-10 px-3 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50 truncate"
        >
          {INTENT_OPTIONS.map(({ group, intents }) => (
            <optgroup key={group} label={group}>
              {intents.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-[10px] text-violet-500 dark:text-violet-400 font-mono mt-1 truncate">{form.intent}</p>
      </div>

      {/* Params */}
      <div>
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Params <span className="text-zinc-400 font-normal">(JSON — leave as {} if none needed)</span>
        </p>
        <textarea
          value={form.params}
          onChange={(e) => { setParamsError(null); setForm((f) => ({ ...f, params: e.target.value })) }}
          rows={2}
          spellCheck={false}
          className={cn(
            'w-full px-3 py-2 rounded-xl text-xs font-mono border bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 resize-none',
            paramsError
              ? 'border-red-400 focus:ring-red-400/50'
              : 'border-zinc-200 dark:border-zinc-700 focus:ring-violet-500/50'
          )}
          placeholder='{"room": "office", "turn_on": false}'
        />
        {paramsError && <p className="text-xs text-red-500 mt-1">{paramsError}</p>}
        <p className="text-[10px] text-zinc-400 mt-1">Room names: office, bedroom, living_room, kitchen</p>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button onClick={validateAndSave} disabled={!form.label.trim() || saving} className="flex-1">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

export default function QuickAsks() {
  const { items, loading, fetch, create, update, remove } = useQuickAskStore()
  const { addToast } = useUIStore()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetch() }, [])

  const handleCreate = async (data) => {
    setSaving(true)
    try {
      await create(data)
      addToast('Quick ask added', 'success')
      setShowCreate(false)
    } catch (e) {
      addToast(e.message || 'Failed to create', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (data) => {
    setSaving(true)
    try {
      await update(editing.id, data)
      addToast('Quick ask updated', 'success')
      setEditing(null)
    } catch (e) {
      addToast(e.message || 'Failed to update', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await remove(id)
      addToast('Deleted', 'success')
    } catch (e) {
      addToast(e.message || 'Failed to delete', 'error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Quick Asks</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            Shortcut buttons that dispatch exact intents — no AI guessing
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Add
        </Button>
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <p className="text-4xl mb-3">⚡</p>
          <p className="text-sm font-medium">No quick asks yet</p>
          <p className="text-xs mt-1 mb-4">Add one to get started</p>
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Add first quick ask
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <AnimatePresence>
          {items.map((qa) => (
            <motion.div
              key={qa.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.15 }}
            >
              <Card className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xl shrink-0">
                  {qa.icon || '⚡'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{qa.label}</p>
                  <p className="text-xs text-violet-500 dark:text-violet-400 font-mono truncate mt-0.5">
                    {qa.intent}
                    {Object.keys(qa.params || {}).length > 0 && (
                      <span className="text-zinc-400 dark:text-zinc-600 ml-1">
                        · {JSON.stringify(qa.params)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing({ ...qa, params: JSON.stringify(qa.params || {}) })}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(qa.id)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New quick ask">
        <QuickAskForm onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={saving} />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit quick ask">
        {editing && (
          <QuickAskForm
            initial={editing}
            onSave={handleUpdate}
            onCancel={() => setEditing(null)}
            saving={saving}
          />
        )}
      </Modal>
    </div>
  )
}
