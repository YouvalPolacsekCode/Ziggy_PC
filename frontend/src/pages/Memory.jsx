import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Brain, RefreshCw, Trash2, Plus, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { getMemory, sendIntent } from '../lib/api'
import { cn } from '../lib/utils'

export default function Memory() {
  const { addToast } = useUIStore()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getMemory()
      setEntries(res.memory || [])
    } catch {
      addToast('Failed to load memory', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const handleDelete = async (key) => {
    try {
      await sendIntent(`forget ${key}`)
      addToast(`Removed "${key}"`, 'success')
      await load()
    } catch {
      addToast('Failed to remove memory', 'error')
    }
  }

  const openEdit = (entry, value) => {
    setEditEntry(entry)
    setEditValue(value)
  }

  const handleEditSave = async () => {
    if (!editValue.trim()) return
    setEditSaving(true)
    try {
      await sendIntent(`remember ${editEntry.key} is ${editValue.trim()}`)
      addToast('Memory updated', 'success')
      setEditEntry(null)
      setEditValue('')
      await load()
    } catch {
      addToast('Failed to update memory', 'error')
    } finally {
      setEditSaving(false)
    }
  }

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return
    setSaving(true)
    try {
      await sendIntent(`remember ${newKey.trim()} is ${newValue.trim()}`)
      addToast('Memory saved', 'success')
      setNewKey('')
      setNewValue('')
      setShowAdd(false)
      await load()
    } catch {
      addToast('Failed to save memory', 'error')
    } finally {
      setSaving(false)
    }
  }

  const filtered = entries.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    const k = (e.key || '').toLowerCase()
    const v = typeof e.value === 'string' ? e.value.toLowerCase() : JSON.stringify(e.value).toLowerCase()
    return k.includes(q) || v.includes(q)
  })

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Memory</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'} stored
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memory…"
          className={cn(
            'w-full h-10 pl-9 pr-4 rounded-xl text-sm',
            'bg-zinc-100 dark:bg-zinc-800',
            'text-zinc-900 dark:text-zinc-100',
            'placeholder:text-zinc-400 dark:placeholder:text-zinc-600',
            'border-0 focus:outline-none focus:ring-2 focus:ring-violet-500/50'
          )}
        />
      </div>

      {/* Info banner */}
      <div className="mb-4 px-3 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/40 flex items-start gap-2.5">
        <Brain size={15} className="text-violet-500 mt-0.5 shrink-0" />
        <p className="text-xs text-violet-700 dark:text-violet-300">
          Ziggy uses this memory to personalize responses. You can add facts, preferences, or anything you want Ziggy to remember about you.
        </p>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <Brain size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">
            {search ? 'No matches found' : 'No memories yet'}
          </p>
          {!search && (
            <p className="text-xs mt-1">Tell Ziggy things to remember about you</p>
          )}
        </div>
      )}

      {/* Memory entries */}
      <Card className="divide-y-0 overflow-hidden">
        <AnimatePresence mode="popLayout">
          {filtered.map((entry, i) => {
            const key = entry.key || `entry_${i}`
            const value = typeof entry.value === 'string'
              ? entry.value
              : JSON.stringify(entry.value)
            const isLong = value.length > 80

            return (
              <motion.div
                key={key}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="flex items-start gap-3 px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0 group hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide truncate">
                      {key}
                    </p>
                  </div>
                  <p className={cn(
                    'text-sm text-zinc-900 dark:text-zinc-100',
                    isLong && 'line-clamp-2'
                  )}>
                    {value}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button
                    onClick={() => openEdit(entry, value)}
                    className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-700 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(key)}
                    className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-700 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </Card>

      {/* Edit memory modal */}
      <Modal open={!!editEntry} onClose={() => setEditEntry(null)} title="Edit Memory">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Key</p>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800">
              {editEntry?.key}
            </p>
          </div>
          <Input
            label="Value"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleEditSave()}
            autoFocus
          />
          <Button onClick={handleEditSave} disabled={!editValue.trim() || editSaving} className="w-full">
            {editSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </Modal>

      {/* Add memory modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Memory">
        <div className="flex flex-col gap-4">
          <Input
            label="Key (what to call this)"
            placeholder="e.g. favorite_color, home_city"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            autoFocus
          />
          <Input
            label="Value"
            placeholder="e.g. blue, Tel Aviv"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <p className="text-xs text-zinc-400">
            Ziggy will be told: <em className="text-zinc-600 dark:text-zinc-300">
              remember {newKey || '[key]'} is {newValue || '[value]'}
            </em>
          </p>
          <Button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || saving} className="w-full">
            {saving ? 'Saving…' : 'Save to memory'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
