import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { getMemory, sendIntent } from '../lib/api'

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

const SOURCE_META = {
  learned: { label: 'learned', tint: 'var(--info)' },
  told:    { label: 'told',    tint: 'var(--ok)' },
  config:  { label: 'config',  tint: 'var(--ink-faint)' },
}

function SourcePill({ src }) {
  const m = SOURCE_META[src] || SOURCE_META.told
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4, flexShrink: 0,
      background: `color-mix(in srgb, ${m.tint} 14%, transparent)`,
      color: m.tint, fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', fontFamily: '"IBM Plex Mono", monospace',
    }}>
      {m.label}
    </span>
  )
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
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
        opacity: selected ? 1 : 0.45, transition: 'opacity 0.15s',
      }}
    >
      <span style={{
        width: 52, height: 52, borderRadius: '50%', background: color, color: '#fff',
        fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: selected ? '2.5px solid var(--ink)' : 'none', boxSizing: 'border-box',
        boxShadow: selected ? '0 0 0 3px color-mix(in srgb, var(--ink) 12%, transparent)' : 'none',
      }}>
        {initial}
      </span>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>
        {name}
      </span>
      {count > 0 && (
        <span style={{ fontSize: 9, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{count}</span>
      )}
    </button>
  )
}

// ── Fact card ─────────────────────────────────────────────────────────────────
function FactCard({ entry, onEdit, onDelete }) {
  const key   = entry.key   || ''
  const sub   = entry.subkey || key
  const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)
  const src   = inferSource(key)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 6 }}
      transition={{ duration: 0.15 }}
      style={{ padding: '14px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <SourcePill src={src} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => onEdit(entry, value)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onClick={() => onDelete(key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <p className="z-eyebrow" style={{ marginBottom: 5 }}>{sub.replace(/_/g, ' ')}</p>
      <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.45, textWrap: 'pretty' }}>{value}</p>
    </motion.div>
  )
}

// ── Main page (Profile-B layout) ──────────────────────────────────────────────
export default function Memory() {
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

  // Filter + group
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

  // Auto-select first profile
  useEffect(() => {
    if (profiles.length > 0 && (!activeProfile || !profiles.includes(activeProfile))) {
      setActiveProfile(profiles[0])
    }
  }, [profiles.join(',')])

  const activeFacts = activeProfile ? (groups[activeProfile] || []) : []

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Local · never leaves this device</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Memory</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: '7px', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          </button>
          <button onClick={() => setShowAdd(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            Add
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div style={{ marginBottom: 18, padding: '10px 14px', borderRadius: 12, background: `color-mix(in srgb, var(--info) 8%, var(--surface))`, border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--info)', flexShrink: 0, marginTop: 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.58A3 3 0 0 1 4.5 9.5a2.5 2.5 0 0 1 3-3.45A2.5 2.5 0 0 1 9.5 2M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.07-4.58A3 3 0 0 0 19.5 9.5a2.5 2.5 0 0 0-3-3.45A2.5 2.5 0 0 0 14.5 2"/></svg>
        </span>
        <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Ziggy uses this to personalise responses. Keys starting with a name (e.g. <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>youval_coffee</span>) appear as person profiles.
        </p>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 18 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search memory…" className="z-input" style={{ paddingLeft: 34 }} />
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No memories yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Tell Ziggy things to remember</p>
        </div>
      )}

      {/* Profile-B layout */}
      {!loading && entries.length > 0 && (
        <>
          {/* Horizontal avatar picker */}
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16, marginBottom: 14, borderBottom: '0.5px solid var(--line)' }}>
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
              <motion.div key={activeProfile} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0, textTransform: 'capitalize' }}>
                    {activeProfile}
                  </h2>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{activeFacts.length} fact{activeFacts.length !== 1 ? 's' : ''}</p>
                </div>

                {/* Facts grid: 2-col on wide, 1-col on narrow */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
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
                      padding: '14px', borderRadius: 12, minHeight: 84,
                      background: 'var(--bg-2)', border: '0.5px dashed var(--line-2)',
                      color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                    Add a fact for {activeProfile}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Edit modal */}
      <Modal open={!!editEntry} onClose={() => setEditEntry(null)} title="Edit Memory">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 4 }}>Key</p>
            <p style={{ fontSize: 13, color: 'var(--ink)', padding: '8px 12px', borderRadius: 9, background: 'var(--bg-2)', fontFamily: '"IBM Plex Mono", monospace' }}>{editEntry?.key}</p>
          </div>
          <Input label="Value" value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEditSave()} autoFocus />
          <button onClick={handleEditSave} disabled={!editValue.trim() || editSaving} className="z-btn-primary" style={{ width: '100%' }}>
            {editSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Modal>

      {/* Add modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Memory">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Key" placeholder="e.g. youval_coffee or home_city" value={newKey} onChange={e => setNewKey(e.target.value)} autoFocus />
          <Input label="Value" placeholder="e.g. every morning with hot milk" value={newValue} onChange={e => setNewValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          {(newKey || newValue) && (
            <p style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }}>
              → remember {newKey || '[key]'} is {newValue || '[value]'}
            </p>
          )}
          <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? 'Saving…' : 'Save to memory'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
