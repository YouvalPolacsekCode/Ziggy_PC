import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, Pencil, X, RefreshCw, Brain } from 'lucide-react'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { getMemory, sendIntent } from '../lib/api'
import { useT } from '../lib/i18n'
import { T_ENTER } from '../lib/motion'

// Derive a colour for any string via a simple hash
const AVATAR_COLORS = [
  'oklch(0.62 0.12 32)',   // terracotta
  'oklch(0.55 0.12 200)',  // blue
  'oklch(0.62 0.10 140)',  // green
  'oklch(0.55 0.12 280)',  // purple
  'oklch(0.60 0.11 60)',   // amber
  'oklch(0.55 0.12 160)',  // teal
]
function colorForName(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

// Infer source tag from key suffix patterns
function inferSource(key) {
  if (key.includes('_learned') || key.includes('_pattern') || key.includes('_behaviour')) return 'learned'
  if (key.includes('_config') || key.includes('_setting')) return 'config'
  return 'told'
}

// Chip = neutral capsule; the source is carried by an 8px dot so no status
// colour ever has to be read as 13px text.
const SOURCE_META = {
  learned: { label: 'learned', dot: 'z-dot-info' },
  told:    { label: 'told',    dot: 'z-dot-ok' },
  config:  { label: 'config',  dot: null },
}

function SourcePill({ src }) {
  const m = SOURCE_META[src] || SOURCE_META.told
  return (
    <span className="z-chip" style={{ flexShrink: 0 }}>
      {m.dot
        ? <span className={`z-dot ${m.dot}`} />
        : <span className="z-dot" style={{ background: 'var(--ink-faint)' }} />}
      {m.label}
    </span>
  )
}

// Borderless 44×44 target for a card-level icon action.
const ghostIcon = {
  width: 40, height: 40, borderRadius: 'var(--r-ctl)', background: 'transparent',
  border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}

// ── Group memory entries by first segment of the key ─────────────────────────
function groupByProfile(entries) {
  const groups = {}
  const noGroup = []

  entries.forEach(entry => {
    const key = entry.key || ''
    const parts = key.split(/[_.]/)
    if (parts.length > 1 && !/^\d/.test(parts[0])) {
      const profile = parts[0]
      if (!groups[profile]) groups[profile] = []
      groups[profile].push({ ...entry, subkey: parts.slice(1).join('_') })
    } else {
      noGroup.push(entry)
    }
  })

  // Add ungrouped items under a "general" profile
  if (noGroup.length > 0) groups['general'] = noGroup.map(e => ({ ...e, subkey: e.key }))

  return groups
}

// ── Profile avatar button ─────────────────────────────────────────────────────
function ProfileAvatar({ name, selected, count, onClick }) {
  const color = colorForName(name)
  const initial = name.charAt(0).toUpperCase()
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
        padding: 0, fontFamily: 'inherit',
      }}
    >
      <span style={{
        width: 52, height: 52, borderRadius: '50%', background: color, color: '#fff',
        fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: selected ? '2px solid var(--ink)' : '2px solid transparent', boxSizing: 'border-box',
        boxShadow: selected ? '0 0 0 3px color-mix(in srgb, var(--ink) 12%, transparent)' : 'none',
        transition: 'box-shadow var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
      }}>
        {initial}
      </span>
      <span style={{ fontSize: 13, fontWeight: selected ? 600 : 500, color: selected ? 'var(--ink)' : 'var(--ink-mute)', lineHeight: 1.2 }}>
        {name}
      </span>
      {count > 0 && (
        <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      )}
    </button>
  )
}

// ── Fact card ─────────────────────────────────────────────────────────────────
function FactCard({ entry, onEdit, onDelete }) {
  const t = useT()
  const key   = entry.key   || ''
  const sub   = entry.subkey || key
  const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)
  const src   = inferSource(key)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 6 }}
      transition={T_ENTER}
      style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <SourcePill src={src} />
        <div style={{ display: 'flex', gap: 0 }}>
          <button onClick={() => onEdit(entry, value)} style={ghostIcon} aria-label={t('common.edit')} title={t('common.edit')}>
            <Pencil size={18} />
          </button>
          <button onClick={() => onDelete(key)} style={ghostIcon} aria-label={t('common.remove')} title={t('common.remove')}>
            <X size={18} />
          </button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 4, textTransform: 'capitalize' }}>{sub.replace(/_/g, ' ')}</p>
      <p style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.45, textWrap: 'pretty' }}>{value}</p>
    </motion.div>
  )
}

// ── Shared hook ──────────────────────────────────────────────────────────────
function useMemoryLogic() {
  const { addToast } = useUIStore()
  const [entries,     setEntries]     = useState([])
  const [loading,     setLoading]     = useState(false)
  const [refreshing,  setRefreshing]  = useState(false)
  const [search,      setSearch]      = useState('')
  const [showAdd,     setShowAdd]     = useState(false)
  const [newKey,      setNewKey]      = useState('')
  const [newValue,    setNewValue]    = useState('')
  const [saving,      setSaving]      = useState(false)
  const [editEntry,   setEditEntry]   = useState(null)
  const [editValue,   setEditValue]   = useState('')
  const [editSaving,  setEditSaving]  = useState(false)
  const [activeProfile, setActiveProfile] = useState(null)

  const load = async () => {
    setLoading(true)
    try { const res = await getMemory(); setEntries(res.memory || []) }
    catch { addToast('Failed to load memory', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleRefresh    = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const handleDelete     = async key => { try { await sendIntent(`forget ${key}`); addToast(`Removed "${key}"`, 'success'); await load() } catch { addToast('Failed to remove memory', 'error') } }
  const handleEditSave   = async () => {
    if (!editValue.trim()) return
    setEditSaving(true)
    try { await sendIntent(`remember ${editEntry.key} is ${editValue.trim()}`); addToast('Memory updated', 'success'); setEditEntry(null); setEditValue(''); await load() }
    catch { addToast('Failed to update memory', 'error') }
    finally { setEditSaving(false) }
  }
  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return
    setSaving(true)
    try { await sendIntent(`remember ${newKey.trim()} is ${newValue.trim()}`); addToast('Memory saved', 'success'); setNewKey(''); setNewValue(''); setShowAdd(false); await load() }
    catch { addToast('Failed to save memory', 'error') }
    finally { setSaving(false) }
  }

  const filtered = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter(e => {
      const k = (e.key || '').toLowerCase()
      const v = typeof e.value === 'string' ? e.value.toLowerCase() : JSON.stringify(e.value).toLowerCase()
      return k.includes(q) || v.includes(q)
    })
  }, [entries, search])

  const groups  = useMemo(() => groupByProfile(filtered), [filtered])
  const profiles = Object.keys(groups).sort()

  useEffect(() => {
    if (profiles.length > 0 && (!activeProfile || !profiles.includes(activeProfile))) {
      setActiveProfile(profiles[0])
    }
  }, [profiles.join(',')])

  const activeFacts = activeProfile ? (groups[activeProfile] || []) : []

  return { entries, loading, refreshing, search, setSearch, showAdd, setShowAdd, newKey, setNewKey, newValue, setNewValue, saving, editEntry, setEditEntry, editValue, setEditValue, editSaving, handleRefresh, handleDelete, handleEditSave, handleAdd, filtered, groups, profiles, activeProfile, setActiveProfile, activeFacts, addToast }
}

// Search field with a leading glyph, 44 tall / 17px like every other input.
function SearchField({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <Search size={18} style={{ position: 'absolute', insetInlineStart: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--ink-faint)', zIndex: 1 }} />
      <Input value={value} onChange={onChange} placeholder={placeholder} style={{ paddingInlineStart: 44 }} />
    </div>
  )
}

// Filter chip for the profile row: an active chip is surface-2 + ink + a
// hairline, never inverted.
function ProfileChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      minHeight: 40, padding: '0 16px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
      fontFamily: 'inherit', textTransform: 'capitalize',
      background: active ? 'var(--surface-2)' : 'transparent',
      color: active ? 'var(--ink)' : 'var(--ink-mute)',
      border: '0.5px solid var(--line)',
      transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
    }}>{label}</button>
  )
}

// ── Settings panel (embedded in Settings › General › Memory) ─────────────────
export function MemoryPanel() {
  const t = useT()
  const s = useMemoryLogic()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <SearchField value={s.search} onChange={e => s.setSearch(e.target.value)} placeholder={t('memory.search')} />
        <button onClick={() => s.setShowAdd(true)} className="z-btn-primary" style={{ flexShrink: 0 }}>
          <Plus size={18} /> {t('common.add')}
        </button>
      </div>

      {s.loading && <div style={{ height: 60, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)' }} />}

      {!s.loading && s.entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink-mute)', fontSize: 13 }}>{t('memory.empty')}</div>
      )}

      {s.profiles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {s.profiles.map(p => (
            <ProfileChip key={p} label={p} active={s.activeProfile === p} onClick={() => s.setActiveProfile(p)} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <AnimatePresence>
          {s.activeFacts.map(e => <FactCard key={e.key} entry={e} onEdit={(entry, val) => { s.setEditEntry(entry); s.setEditValue(val) }} onDelete={s.handleDelete} />)}
        </AnimatePresence>
      </div>

      {/* Add / Edit modals */}
      <Modal open={s.showAdd} onClose={() => s.setShowAdd(false)} title={t('memory.modalAddTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label={t('memory.labelKey')} placeholder={t('memory.keyPlaceholderShort')} value={s.newKey} onChange={e => s.setNewKey(e.target.value)} />
          <Input label={t('memory.labelValue')} placeholder={t('memory.valuePlaceholderShort')} value={s.newValue} onChange={e => s.setNewValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && s.handleAdd()} />
          <button onClick={s.handleAdd} disabled={!s.newKey.trim() || !s.newValue.trim() || s.saving} className="z-btn-primary" style={{ width: '100%' }}>{s.saving ? t('common.saving') : t('memory.saveToMemory')}</button>
        </div>
      </Modal>
      <Modal open={!!s.editEntry} onClose={() => s.setEditEntry(null)} title={t('memory.modalEditTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label={t('memory.labelKey')} value={s.editEntry?.key || ''} disabled />
          <Input label={t('memory.labelValue')} value={s.editValue} onChange={e => s.setEditValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && s.handleEditSave()} autoFocus />
          <button onClick={s.handleEditSave} disabled={!s.editValue.trim() || s.editSaving} className="z-btn-primary" style={{ width: '100%' }}>{s.editSaving ? t('common.saving') : t('common.save')}</button>
        </div>
      </Modal>
    </div>
  )
}

// ── Main page (Profile-B layout) ──────────────────────────────────────────────
export default function Memory() {
  const t = useT()
  const { entries, loading, refreshing, search, setSearch, showAdd, setShowAdd, newKey, setNewKey, newValue, setNewValue, saving, editEntry, setEditEntry, editValue, setEditValue, editSaving, handleRefresh, handleDelete, handleEditSave, handleAdd, filtered, groups, profiles, activeProfile, setActiveProfile, activeFacts } = useMemoryLogic()

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>

      {/* Header */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">{t('memory.eyebrow')}</p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('memory.title')}</h1>
          <p className="z-footnote" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t(entries.length === 1 ? 'memory.entry' : 'memory.entries', { n: entries.length })} · {t(profiles.length === 1 ? 'memory.profile' : 'memory.profiles', { n: profiles.length })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={handleRefresh} disabled={refreshing} className="z-icon-btn" aria-label={t('common.refresh')} title={t('common.refresh')}>
            <RefreshCw size={18} className={refreshing ? 'z-spin' : undefined} />
          </button>
          <button onClick={() => setShowAdd(true)} className="z-btn-primary">
            <Plus size={18} />
            {t('common.add')}
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Brain size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          {t('memory.infoBanner')} <span className="z-code">youval_coffee</span>{t('memory.infoBannerAfter')}
        </p>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', marginBottom: 16 }}>
        <SearchField value={search} onChange={e => setSearch(e.target.value)} placeholder={t('memory.search')} />
      </div>

      {/* Loading skeleton — only on cold start; cached entries stay visible
          during a background refresh. */}
      {loading && entries.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{t('memory.noMemoriesTitle')}</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16 }}>{t('memory.noMemoriesHelp')}</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary">{t('common.add')}</button>
        </div>
      )}

      {/* Profile-B layout */}
      {entries.length > 0 && (
        <>
          {/* Horizontal avatar picker */}
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16, marginBottom: 16, borderBottom: '0.5px solid var(--line)' }}>
            {profiles.map(p => (
              <ProfileAvatar
                key={p}
                name={p}
                selected={activeProfile === p}
                count={groups[p]?.length || 0}
                onClick={() => setActiveProfile(p)}
              />
            ))}
          </div>

          {/* Selected profile's facts */}
          <AnimatePresence mode="wait">
            {activeProfile && (
              <motion.div key={activeProfile} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T_ENTER}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h2 className="z-title" style={{ margin: 0, textTransform: 'capitalize' }}>
                    {activeProfile}
                  </h2>
                  <p style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>{t(activeFacts.length === 1 ? 'memory.fact' : 'memory.facts', { n: activeFacts.length })}</p>
                </div>

                {/* Facts grid: 2-col on wide, 1-col on narrow */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  <AnimatePresence mode="popLayout">
                    {activeFacts.map((entry, i) => (
                      <FactCard
                        key={entry.key || i}
                        entry={entry}
                        onEdit={(e, v) => { setEditEntry(e); setEditValue(v) }}
                        onDelete={handleDelete}
                      />
                    ))}
                  </AnimatePresence>
                  {/* Add a fact */}
                  <button
                    onClick={() => { setNewKey(activeProfile === 'general' ? '' : `${activeProfile}_`); setNewValue(''); setShowAdd(true) }}
                    style={{
                      padding: 12, borderRadius: 'var(--r-card)', minHeight: 84,
                      background: 'var(--bg-2)', border: '0.5px dashed var(--line-2)',
                      color: 'var(--ink-mute)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    <Plus size={18} />
                    {t('memory.addFactFor', { profile: activeProfile })}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Edit modal */}
      <Modal open={!!editEntry} onClose={() => setEditEntry(null)} title={t('memory.modalEditTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 4 }}>{t('memory.labelKey')}</p>
            <p className="z-code" style={{ fontSize: 13, color: 'var(--ink)', padding: '12px 16px', borderRadius: 'var(--r-ctl)', background: 'var(--bg-2)' }}>{editEntry?.key}</p>
          </div>
          <Input label={t('memory.labelValue')} value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEditSave()} autoFocus />
          <button onClick={handleEditSave} disabled={!editValue.trim() || editSaving} className="z-btn-primary" style={{ width: '100%' }}>
            {editSaving ? t('common.saving') : t('memory.saveChanges')}
          </button>
        </div>
      </Modal>

      {/* Add modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('memory.modalAddTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input label={t('memory.labelKey')} placeholder={t('memory.keyPlaceholder')} value={newKey} onChange={e => setNewKey(e.target.value)} autoFocus />
          <Input label={t('memory.labelValue')} placeholder={t('memory.valuePlaceholder')} value={newValue} onChange={e => setNewValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          {(newKey || newValue) && (
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>
              {t('memory.preview', { key: newKey || t('memory.previewKeyHolder'), value: newValue || t('memory.previewValueHolder') })}
            </p>
          )}
          <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? t('common.saving') : t('memory.saveToMemory')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
