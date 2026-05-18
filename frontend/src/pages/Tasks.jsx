import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useTaskStore } from '../stores/taskStore'
import { useUIStore } from '../stores/uiStore'
import { formatDate, isHebrew } from '../lib/utils'

const PRIORITY_COLOR = { high: 'var(--accent)', medium: 'var(--warn)', low: 'var(--line-2)' }

// ── Icons ─────────────────────────────────────────────────────────────────────
function ZIcon({ name, size = 14 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'circle':    return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>
    case 'check-c':   return <svg {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
    case 'check':     return <svg {...p}><path d="M20 6L9 17l-5-5"/></svg>
    case 'plus':      return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>
    case 'trash':     return <svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    case 'edit':      return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    case 'chev-d':    return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>
    case 'square':    return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
    case 'x':         return <svg {...p}><path d="M18 6L6 18M6 6l12 12"/></svg>
    case 'cal':       return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    case 'clock':     return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    default: return null
  }
}

// ── Sub-item row ──────────────────────────────────────────────────────────────
function SubItem({ item, onToggle }) {
  const rtl = isHebrew(item.text)
  return (
    <button
      onClick={onToggle}
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer',
        textAlign: 'start',
      }}
    >
      <span style={{ color: item.done ? 'var(--ok)' : 'var(--line-2)', flexShrink: 0 }}>
        <ZIcon name={item.done ? 'check-c' : 'square'} size={13} />
      </span>
      <span style={{
        fontSize: 12, color: item.done ? 'var(--ink-faint)' : 'var(--ink-2)',
        textDecoration: item.done ? 'line-through' : 'none',
      }}>
        {item.text}
      </span>
    </button>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task, onToggle, onUpdateItems, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const isDone  = task.done || task.completed
  const items   = task.items || []
  const doneItems = items.filter(i => i.done).length
  const hasExtras = task.description || items.length > 0
  const pColor  = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.low
  const isOverdue = !isDone && task.due && new Date(task.due) < new Date()

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }}
      style={{
        display: 'flex', flexDirection: 'column',
        padding: '12px 14px', borderRadius: 11,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Priority ring + check */}
        <button
          onClick={() => onToggle(task)}
          style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
            border: `1.5px solid ${isDone ? 'var(--ok)' : pColor}`,
            background: isDone ? 'var(--ok)' : 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isDone ? '#fff' : 'transparent',
          }}
        >
          {isDone && <ZIcon name="check" size={11} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            dir={isHebrew(task.task || task.title) ? 'rtl' : 'ltr'}
            style={{
              fontSize: 14, fontWeight: task.priority === 'high' && !isDone ? 600 : 500,
              color: isDone ? 'var(--ink-faint)' : 'var(--ink)',
              lineHeight: 1.3,
              textDecoration: isDone ? 'line-through' : 'none',
            }}
          >
            {task.task || task.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
            {task.due && (
              <span style={{
                fontSize: 10.5, color: isOverdue ? 'var(--accent)' : 'var(--ink-faint)',
                fontFamily: '"IBM Plex Mono", monospace',
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <ZIcon name="cal" size={10} />
                {formatDate(task.due)}
              </span>
            )}
            {task.reminder && (
              <span style={{
                fontSize: 10.5, color: 'var(--ink-faint)',
                fontFamily: '"IBM Plex Mono", monospace',
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <ZIcon name="clock" size={10} />
                {task.reminder}
              </span>
            )}
            {items.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                {doneItems}/{items.length}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {hasExtras && (
            <button onClick={() => setExpanded(v => !v)} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4,
              transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
            }}>
              <ZIcon name="chev-d" size={13} />
            </button>
          )}
          <button onClick={() => onEdit(task)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}>
            <ZIcon name="edit" size={13} />
          </button>
          <button onClick={() => onDelete(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}>
            <ZIcon name="trash" size={13} />
          </button>
        </div>
      </div>

      {/* Expandable sub-items + description */}
      <AnimatePresence>
        {expanded && hasExtras && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingInlineStart: 32, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {task.description && (
                <p
                  dir={isHebrew(task.description) ? 'rtl' : 'ltr'}
                  style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}
                >
                  {task.description}
                </p>
              )}
              {items.map((item, idx) => (
                <SubItem key={idx} item={item} onToggle={() => {
                  const updated = items.map((it, i) => i === idx ? { ...it, done: !it.done } : it)
                  onUpdateItems(task.id, updated)
                }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Task form (shared by add + edit) ─────────────────────────────────────────
function TaskForm({ values, onChange }) {
  const { taskText, description, due, priority, itemInput, items } = values
  const addItem = () => {
    const text = itemInput.trim()
    if (!text) return
    onChange({ items: [...items, { text, done: false }], itemInput: '' })
  }
  const removeItem = (idx) => onChange({ items: items.filter((_, i) => i !== idx) })
  const toggleItem = (idx) => onChange({ items: items.map((it, i) => i === idx ? { ...it, done: !it.done } : it) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Input label="Task" placeholder="What needs to be done?" value={taskText} onChange={e => onChange({ taskText: e.target.value })} dir="auto" autoFocus onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
      <Textarea label="Description (optional)" placeholder="Add details or notes…" value={description} onChange={e => onChange({ description: e.target.value })} dir="auto" rows={2} />
      <Input label="Due date (optional)" type="datetime-local" value={due} onChange={e => onChange({ due: e.target.value })} />
      <Select label="Priority" value={priority} onChange={e => onChange({ priority: e.target.value })} options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />

      <div>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Checklist items</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={itemInput}
            onChange={e => onChange({ itemInput: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
            placeholder="Add an item…"
            dir="auto"
            className="z-input"
            style={{ height: 36, padding: '0 12px', fontSize: 13 }}
          />
          <button onClick={addItem} className="z-btn-secondary" style={{ padding: '0 14px', borderRadius: 9, height: 36, whiteSpace: 'nowrap' }}>Add</button>
        </div>
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
            {items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => toggleItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: item.done ? 'var(--ok)' : 'var(--line-2)', padding: 0, flexShrink: 0 }}>
                  <ZIcon name={item.done ? 'check-c' : 'square'} size={14} />
                </button>
                <span dir={isHebrew(item.text) ? 'rtl' : 'ltr'} style={{ flex: 1, fontSize: 12, color: item.done ? 'var(--ink-faint)' : 'var(--ink-2)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
                <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 0 }}>
                  <ZIcon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add modal ─────────────────────────────────────────────────────────────────
function AddTaskModal({ open, onClose, onAdd }) {
  const [vals, setVals] = useState({ taskText: '', description: '', due: '', priority: 'medium', itemInput: '', items: [] })
  const [saving, setSaving] = useState(false)
  const change = (p) => setVals(v => ({ ...v, ...p }))
  const reset  = () => setVals({ taskText: '', description: '', due: '', priority: 'medium', itemInput: '', items: [] })
  const handle = async () => {
    if (!vals.taskText.trim()) return
    setSaving(true)
    await onAdd({ task: vals.taskText.trim(), due: vals.due || null, priority: vals.priority, description: vals.description.trim() || null, items: vals.items.length ? vals.items : null })
    setSaving(false); reset(); onClose()
  }
  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="New Task">
      <TaskForm values={vals} onChange={change} />
      <button className="z-btn-primary" onClick={handle} disabled={!vals.taskText.trim() || saving} style={{ width: '100%', marginTop: 16 }}>
        {saving ? 'Adding…' : 'Add task'}
      </button>
    </Modal>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditTaskModal({ open, onClose, onSave, task }) {
  const [vals, setVals] = useState({ taskText: '', description: '', due: '', priority: 'medium', itemInput: '', items: [] })
  const [saving, setSaving] = useState(false)
  const change = (p) => setVals(v => ({ ...v, ...p }))
  useEffect(() => {
    if (task) setVals({ taskText: task.task || task.title || '', description: task.description || '', due: task.due ? task.due.slice(0, 16) : '', priority: task.priority || 'medium', itemInput: '', items: task.items || [] })
  }, [task])
  const handle = async () => {
    if (!vals.taskText.trim()) return
    setSaving(true)
    await onSave(task.id, { task: vals.taskText.trim(), due: vals.due || null, priority: vals.priority, description: vals.description.trim() || null, items: vals.items.length ? vals.items : null })
    setSaving(false); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Edit Task">
      <TaskForm values={vals} onChange={change} />
      <button className="z-btn-primary" onClick={handle} disabled={!vals.taskText.trim() || saving} style={{ width: '100%', marginTop: 16 }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </Modal>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────
function TaskGroup({ label, count, tint, tasks, ...rowProps }) {
  if (!tasks.length) return null
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 4, height: 14, borderRadius: 2, background: tint, flexShrink: 0 }} />
        <p className="z-eyebrow">{label}</p>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginLeft: 'auto' }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <AnimatePresence mode="popLayout">
          {tasks.map(t => <TaskRow key={t.id || t.task} task={t} {...rowProps} />)}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const FILTERS = [
  { id: 'pending', label: 'Pending' },
  { id: 'all',     label: 'All' },
  { id: 'high',    label: 'High priority' },
  { id: 'done',    label: 'Done' },
]

export default function Tasks() {
  const { tasks, loading, fetch, add, update, remove } = useTaskStore()
  const { addToast } = useUIStore()
  const [filter,   setFilter]   = useState('pending')
  const [showAdd,  setShowAdd]  = useState(false)
  const [editTask, setEditTask] = useState(null)

  useEffect(() => { fetch() }, [])

  const handleToggle      = async (task) => { try { await update(task.id, { done: !(task.done || task.completed) }) } catch { addToast('Failed to update task', 'error') } }
  const handleUpdateItems = async (id, items) => { try { await update(id, { items }) } catch { addToast('Failed to update', 'error') } }
  const handleDelete      = async (id) => { try { await remove(id); addToast('Task deleted', 'success') } catch { addToast('Failed to delete', 'error') } }
  const handleAdd         = async (data) => { try { await add(data); addToast('Task added', 'success') } catch { addToast('Failed to add task', 'error') } }
  const handleEdit        = async (id, data) => { try { await update(id, data); addToast('Task updated', 'success'); setEditTask(null) } catch { addToast('Failed to update task', 'error') } }

  const now = new Date()
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const weekEnd  = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7)

  const filtered = tasks.filter(t => {
    const isDone = t.done || t.completed
    if (filter === 'pending') return !isDone
    if (filter === 'done') return isDone
    if (filter === 'high') return t.priority === 'high' && !isDone
    return true
  })

  // Group by time bucket (only for pending/all/high)
  const pending = filtered.filter(t => !(t.done || t.completed))
  const done    = filtered.filter(t => t.done || t.completed)

  const todayTasks  = pending.filter(t => t.due && new Date(t.due) <= todayEnd)
  const weekTasks   = pending.filter(t => t.due && new Date(t.due) > todayEnd && new Date(t.due) <= weekEnd)
  const laterTasks  = pending.filter(t => !t.due || new Date(t.due) > weekEnd)
  const groupedView = filter !== 'done'

  const pendingCount = tasks.filter(t => !t.done && !t.completed).length

  const rowProps = { onToggle: handleToggle, onUpdateItems: handleUpdateItems, onDelete: handleDelete, onEdit: setEditTask }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Tasks</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, lineHeight: 1 }}>
            {pendingCount > 0 ? `${pendingCount} pending` : 'All clear'}
          </h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {tasks.length} total
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="z-btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10 }}
        >
          <ZIcon name="plus" size={14} />
          New task
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 22, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '5px 12px', borderRadius: 999,
              background: filter === f.id ? 'var(--ink)' : 'var(--surface)',
              color:      filter === f.id ? 'var(--bg)'  : 'var(--ink-mute)',
              border: filter === f.id ? 'none' : '0.5px solid var(--line)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ height: 52, borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--ink-faint)' }}>
          <p className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>
            {filter === 'pending' ? 'All caught up' : 'Nothing here'}
          </p>
        </div>
      )}

      {/* Grouped view */}
      {!loading && groupedView && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {(todayTasks.length > 0 || weekTasks.length > 0 || laterTasks.length > 0) ? (
            <>
              <TaskGroup label="Today" count={todayTasks.length} tint="var(--accent)" tasks={todayTasks} {...rowProps} />
              <TaskGroup label="This week" count={weekTasks.length} tint="var(--warn)" tasks={weekTasks} {...rowProps} />
              <TaskGroup label="Later / no date" count={laterTasks.length} tint="var(--line-2)" tasks={laterTasks} {...rowProps} />
            </>
          ) : (
            filtered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <AnimatePresence mode="popLayout">
                  {filtered.map(t => <TaskRow key={t.id || t.task} task={t} {...rowProps} />)}
                </AnimatePresence>
              </div>
            )
          )}
        </div>
      )}

      {/* Done view — flat list */}
      {!loading && !groupedView && done.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <AnimatePresence mode="popLayout">
            {done.map(t => <TaskRow key={t.id || t.task} task={t} {...rowProps} />)}
          </AnimatePresence>
        </div>
      )}

      <AddTaskModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
      <EditTaskModal open={!!editTask} onClose={() => setEditTask(null)} onSave={handleEdit} task={editTask} />
    </div>
  )
}
