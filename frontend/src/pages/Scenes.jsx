import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Play } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { getScenes, activateScene, createScene, deleteScene } from '../lib/api'
import { Modal } from '../components/ui/Modal'
import { cn } from '../lib/utils'

const SCENE_TINTS = [
  'oklch(0.85 0.10 75)',
  'oklch(0.35 0.10 280)',
  'oklch(0.40 0.06 250)',
  'oklch(0.65 0.10 130)',
  'oklch(0.72 0.12 20)',
  'oklch(0.55 0.12 200)',
  'oklch(0.62 0.10 140)',
]

const CONTROLLABLE_DOMAINS = new Set(['light', 'switch', 'climate', 'cover', 'media_player', 'fan', 'lock'])

// ── Create scene modal ────────────────────────────────────────────────────────
function CreateSceneModal({ open, onClose, onCreated }) {
  const { entities } = useDeviceStore()
  const { addToast } = useUIStore()
  const [name,    setName]    = useState('')
  const [search,  setSearch]  = useState('')
  const [picked,  setPicked]  = useState(new Set())
  const [saving,  setSaving]  = useState(false)

  // Only controllable entities, no IR
  const candidates = entities
    .filter(e => CONTROLLABLE_DOMAINS.has(e.domain) && !e._ir)
    .sort((a, b) => (a.display_name || a.friendly_name || '').localeCompare(b.display_name || b.friendly_name || ''))

  const visible = candidates.filter(e => {
    const label = (e.display_name || e.friendly_name || e.entity_id).toLowerCase()
    return !search || label.includes(search.toLowerCase())
  })

  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleCreate = async () => {
    if (!name.trim()) return
    if (picked.size === 0) { addToast('Select at least one entity to snapshot', 'error'); return }
    setSaving(true)
    try {
      await createScene(name.trim(), [...picked])
      addToast(`Scene "${name}" created`, 'success')
      onCreated()
      setName(''); setSearch(''); setPicked(new Set())
    } catch (e) {
      addToast(e.message || 'Failed to create scene', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setName(''); setSearch(''); setPicked(new Set())
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create scene">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>Scene name</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Movie night, Morning routine…"
            className="z-input" autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
              Snapshot devices <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(captures current state)</span>
            </label>
            {picked.size > 0 && (
              <span style={{ fontSize: 11, color: 'var(--info)', fontFamily: '"IBM Plex Mono", monospace' }}>{picked.size} selected</span>
            )}
          </div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search devices…" className="z-input"
            style={{ marginBottom: 8 }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }} className="scrollbar-thin">
            {visible.map(e => {
              const label = e.display_name || e.friendly_name || e.entity_id.split('.')[1]
              const isOn  = picked.has(e.entity_id)
              return (
                <button key={e.entity_id} onClick={() => toggle(e.entity_id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8, textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
                  background: isOn ? 'color-mix(in srgb, var(--info) 10%, var(--surface))' : 'var(--bg-2)',
                  border: `0.5px solid ${isOn ? 'color-mix(in srgb, var(--info) 35%, var(--line))' : 'var(--line)'}`,
                }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${isOn ? 'var(--info)' : 'var(--line-2)'}`, background: isOn ? 'var(--info)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isOn && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
                    <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{e.entity_id} · {e.state}</p>
                  </div>
                </button>
              )
            })}
            {visible.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '12px 0', textAlign: 'center' }}>No devices found</p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button onClick={handleClose} className="z-btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || picked.size === 0 || saving} className="z-btn-primary" style={{ flex: 1 }}>
            {saving ? 'Creating…' : 'Create scene'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Scenes page ───────────────────────────────────────────────────────────────
export default function Scenes() {
  const { addToast }    = useUIStore()
  const [scenes,        setScenes]        = useState([])
  const [loading,       setLoading]       = useState(false)
  const [refreshing,    setRefreshing]    = useState(false)
  const [activating,    setActivating]    = useState(null)
  const [showCreate,    setShowCreate]    = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting,      setDeleting]      = useState(null)

  const load = async () => {
    setLoading(true)
    try { const res = await getScenes(); setScenes(res.scenes || []) }
    catch { addToast('Failed to load scenes', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const handleActivate = async (scene) => {
    setActivating(scene.entity_id)
    try { await activateScene(scene.entity_id); addToast(`"${scene.name}" activated`, 'success') }
    catch { addToast('Failed to activate scene', 'error') }
    finally { setActivating(null) }
  }

  const handleDelete = async (scene) => {
    setDeleting(scene.entity_id)
    setConfirmDelete(null)
    try {
      await deleteScene(scene.entity_id)
      setScenes(prev => prev.filter(s => s.entity_id !== scene.entity_id))
      addToast(`"${scene.name}" deleted`, 'success')
    } catch (e) {
      addToast(e.message || 'Failed to delete — scene may be defined in HA config files', 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Home Assistant</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Scenes</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          </button>
          <button onClick={() => setShowCreate(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Plus size={13} /> New scene
          </button>
        </div>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[1,2,3,4,5,6].map(i => <div key={i} style={{ height: 110, borderRadius: 13, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && scenes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No scenes yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>Create one here or in Home Assistant</p>
          <button onClick={() => setShowCreate(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Plus size={13} /> Create first scene
          </button>
        </div>
      )}

      {/* Scene grid — 3 columns, medium-height cards */}
      {!loading && scenes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          <AnimatePresence mode="popLayout">
            {scenes.map((scene, idx) => {
              const tint      = SCENE_TINTS[idx % SCENE_TINTS.length]
              const isActive  = activating  === scene.entity_id
              const isDeleting = deleting   === scene.entity_id

              return (
                <motion.div
                  key={scene.entity_id} layout
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                  style={{ position: 'relative' }}
                  className="group"
                >
                  <button
                    onClick={() => handleActivate(scene)}
                    disabled={isActive || isDeleting}
                    style={{
                      width: '100%', padding: '16px 16px 14px',
                      borderRadius: 13, border: 'none', cursor: isActive ? 'default' : 'pointer',
                      background: `linear-gradient(145deg, ${tint} 0%, oklch(0.20 0.02 250) 100%)`,
                      textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10,
                      opacity: isActive || isDeleting ? 0.65 : 1, transition: 'opacity 0.15s, transform 0.1s',
                      position: 'relative', overflow: 'hidden',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(-1px)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
                  >
                    {/* Glow */}
                    <span style={{ position: 'absolute', right: -16, top: -16, width: 64, height: 64, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%)', pointerEvents: 'none' }} />

                    {/* Top row: icon + activate indicator */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ color: 'rgba(255,255,255,0.8)' }}>
                        {isActive ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: 0, transition: 'opacity 0.12s' }} className="group-hover:opacity-100">
                        <Play size={11} style={{ color: 'rgba(255,255,255,0.7)' }} />
                      </div>
                    </div>

                    {/* Scene name */}
                    <p style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.3)', margin: 0 }}>
                      {scene.name}
                    </p>
                  </button>

                  {/* Delete button — visible on hover */}
                  <button
                    onClick={e => { e.stopPropagation(); setConfirmDelete(scene) }}
                    disabled={isDeleting}
                    className="group-hover:opacity-100"
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 24, height: 24, borderRadius: 6,
                      background: 'rgba(0,0,0,0.35)', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'rgba(255,255,255,0.75)', opacity: 0, transition: 'opacity 0.15s',
                    }}
                    title="Delete scene"
                  >
                    <Trash2 size={11} />
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create modal */}
      <CreateSceneModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); handleRefresh() }} />

      {/* Confirm delete */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete scene">
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16, lineHeight: 1.5 }}>
          Delete <strong style={{ color: 'var(--ink)' }}>{confirmDelete?.name}</strong>?
          {' '}This removes it from Home Assistant. Scenes defined in YAML config files cannot be deleted this way.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setConfirmDelete(null)} className="z-btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={() => handleDelete(confirmDelete)}
            style={{ flex: 1, background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: 10, padding: '10px 16px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}
