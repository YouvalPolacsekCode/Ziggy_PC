import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, CheckCircle2, Circle, Calendar, Flag, Clock,
  Trash2, ChevronDown, Check, Square, Pencil, X,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useTaskStore } from '../stores/taskStore'
import { useUIStore } from '../stores/uiStore'
import { formatDate } from '../lib/utils'
import { cn } from '../lib/utils'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'done', label: 'Done' },
  { id: 'high', label: 'High' },
]

const PRIORITY_VARIANTS = { high: 'danger', medium: 'warning', low: 'default' }

function SubItem({ item, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full text-left group py-0.5"
    >
      {item.done ? (
        <Check size={13} className="text-emerald-500 shrink-0" />
      ) : (
        <Square size={13} className="text-zinc-300 dark:text-zinc-600 shrink-0 group-hover:text-zinc-500 transition-colors" />
      )}
      <span className={cn(
        'text-xs',
        item.done
          ? 'text-zinc-400 dark:text-zinc-600 line-through'
          : 'text-zinc-700 dark:text-zinc-300'
      )}>
        {item.text}
      </span>
    </button>
  )
}

function TaskItem({ task, onToggle, onUpdateItems, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const isDone = task.done || task.completed
  const items = task.items || []
  const doneItems = items.filter((i) => i.done).length
  const hasExtras = task.description || items.length > 0

  const handleItemToggle = (idx) => {
    const updated = items.map((it, i) => i === idx ? { ...it, done: !it.done } : it)
    onUpdateItems(task.id, updated)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
    >
      <div className="flex items-start gap-3 py-3 group" onDoubleClick={() => onEdit(task)}>
        <button
          onClick={() => onToggle(task)}
          className="mt-0.5 shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-emerald-500 transition-colors"
        >
          {isDone
            ? <CheckCircle2 size={20} className="text-emerald-500" />
            : <Circle size={20} />}
        </button>

        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-medium leading-snug',
            isDone ? 'text-zinc-400 dark:text-zinc-600 line-through' : 'text-zinc-900 dark:text-zinc-100'
          )}>
            {task.task || task.title}
          </p>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {task.priority && (
              <Badge variant={PRIORITY_VARIANTS[task.priority] || 'default'} className="text-[10px]">
                <Flag size={9} className="mr-1" />{task.priority}
              </Badge>
            )}
            {task.due && (
              <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                <Calendar size={10} />{formatDate(task.due)}
              </span>
            )}
            {task.reminder && (
              <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                <Clock size={10} />{task.reminder}
              </span>
            )}
            {items.length > 0 && (
              <span className="text-[10px] text-zinc-400">
                {doneItems}/{items.length} items
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {hasExtras && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
          <button
            onClick={() => onEdit(task)}
            className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-700 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-700 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && hasExtras && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pl-8 pr-3 pb-3 flex flex-col gap-2">
              {task.description && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {task.description}
                </p>
              )}
              {items.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                  {items.map((item, idx) => (
                    <SubItem key={idx} item={item} onToggle={() => handleItemToggle(idx)} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function AddTaskModal({ open, onClose, onAdd }) {
  const [taskText, setTaskText] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('medium')
  const [itemInput, setItemInput] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTaskText(''); setDescription(''); setDue('')
    setPriority('medium'); setItemInput(''); setItems([])
  }

  const addItem = () => {
    const text = itemInput.trim()
    if (!text) return
    setItems((prev) => [...prev, { text, done: false }])
    setItemInput('')
  }

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const handleAdd = async () => {
    if (!taskText.trim()) return
    setSaving(true)
    await onAdd({
      task: taskText.trim(),
      due: due || null,
      priority,
      description: description.trim() || null,
      items: items.length > 0 ? items : null,
    })
    setSaving(false)
    reset()
    onClose()
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="New Task">
      <div className="flex flex-col gap-4">
        <Input
          label="Task"
          placeholder="What needs to be done?"
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Textarea
          label="Description (optional)"
          placeholder="Add details or notes…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <Input
          label="Due date (optional)"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Select
          label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          options={[
            { value: 'high', label: '🔴 High' },
            { value: 'medium', label: '🟡 Medium' },
            { value: 'low', label: '⚪ Low' },
          ]}
        />

        {/* Sub-items */}
        <div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            Items / Checklist
          </p>
          <div className="flex gap-2 mb-2">
            <input
              value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder="Add an item…"
              className={cn(
                'flex-1 h-9 px-3 rounded-xl text-sm',
                'bg-zinc-50 dark:bg-zinc-800',
                'border border-zinc-200 dark:border-zinc-700',
                'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400',
                'focus:outline-none focus:ring-2 focus:ring-violet-500'
              )}
            />
            <button
              type="button"
              onClick={addItem}
              className="px-3 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm"
            >
              Add
            </button>
          </div>
          {items.length > 0 && (
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 group">
                  <Square size={12} className="text-zinc-300 shrink-0" />
                  <span className="flex-1">{item.text}</span>
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button variant="primary" onClick={handleAdd} disabled={!taskText.trim() || saving} className="w-full mt-1">
          {saving ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </Modal>
  )
}

function EditTaskModal({ open, onClose, onSave, task }) {
  const [taskText, setTaskText] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('medium')
  const [itemInput, setItemInput] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (task) {
      setTaskText(task.task || task.title || '')
      setDescription(task.description || '')
      setDue(task.due ? task.due.slice(0, 16) : '')
      setPriority(task.priority || 'medium')
      setItems(task.items || [])
    }
  }, [task])

  const addItem = () => {
    const text = itemInput.trim()
    if (!text) return
    setItems((prev) => [...prev, { text, done: false }])
    setItemInput('')
  }

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const toggleItem = (idx) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, done: !it.done } : it))

  const handleSave = async () => {
    if (!taskText.trim()) return
    setSaving(true)
    await onSave(task.id, {
      task: taskText.trim(),
      due: due || null,
      priority,
      description: description.trim() || null,
      items: items.length > 0 ? items : null,
    })
    setSaving(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Task">
      <div className="flex flex-col gap-4">
        <Input
          label="Task"
          placeholder="What needs to be done?"
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          autoFocus
        />
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Description (optional)</label>
            {description && (
              <button
                type="button"
                onClick={() => setDescription('')}
                className="text-[10px] text-zinc-400 hover:text-red-500 transition-colors flex items-center gap-0.5"
              >
                <X size={10} /> Clear
              </button>
            )}
          </div>
          <Textarea
            placeholder="Add details or notes…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <Input
          label="Due date (optional)"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Select
          label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          options={[
            { value: 'high', label: '🔴 High' },
            { value: 'medium', label: '🟡 Medium' },
            { value: 'low', label: '⚪ Low' },
          ]}
        />
        <div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Items / Checklist</p>
          <div className="flex gap-2 mb-2">
            <input
              value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder="Add an item…"
              className={cn(
                'flex-1 h-9 px-3 rounded-xl text-sm',
                'bg-zinc-50 dark:bg-zinc-800',
                'border border-zinc-200 dark:border-zinc-700',
                'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400',
                'focus:outline-none focus:ring-2 focus:ring-violet-500'
              )}
            />
            <button type="button" onClick={addItem} className="px-3 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm">Add</button>
          </div>
          {items.length > 0 && (
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 group">
                  <button type="button" onClick={() => toggleItem(idx)} className="shrink-0">
                    {item.done
                      ? <Check size={13} className="text-emerald-500" />
                      : <Square size={13} className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 transition-colors" />}
                  </button>
                  <span className={cn('flex-1', item.done && 'line-through text-zinc-400 dark:text-zinc-600')}>
                    {item.text}
                  </span>
                  <button onClick={() => removeItem(idx)} className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <Button variant="primary" onClick={handleSave} disabled={!taskText.trim() || saving} className="w-full mt-1">
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  )
}

export default function Tasks() {
  const { tasks, loading, fetch, add, update, remove } = useTaskStore()
  const { addToast } = useUIStore()
  const [filter, setFilter] = useState('pending')
  const [showAdd, setShowAdd] = useState(false)
  const [editTask, setEditTask] = useState(null)

  useEffect(() => { fetch() }, [])

  const handleToggle = async (task) => {
    try {
      await update(task.id, { done: !(task.done || task.completed) })
    } catch {
      addToast('Failed to update task', 'error')
    }
  }

  const handleUpdateItems = async (id, items) => {
    try {
      await update(id, { items })
    } catch {
      addToast('Failed to update', 'error')
    }
  }

  const handleDelete = async (id) => {
    try {
      await remove(id)
      addToast('Task deleted', 'success')
    } catch {
      addToast('Failed to delete', 'error')
    }
  }

  const handleAdd = async (data) => {
    try {
      await add(data)
      addToast('Task added', 'success')
    } catch {
      addToast('Failed to add task', 'error')
    }
  }

  const handleEdit = async (id, data) => {
    try {
      await update(id, data)
      addToast('Task updated', 'success')
      setEditTask(null)
    } catch {
      addToast('Failed to update task', 'error')
    }
  }

  const filtered = tasks.filter((t) => {
    const isDone = t.done || t.completed
    if (filter === 'pending') return !isDone
    if (filter === 'done') return isDone
    if (filter === 'high') return t.priority === 'high' && !isDone
    return true
  })

  const pendingCount = tasks.filter((t) => !t.done && !t.completed).length

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Tasks</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {pendingCount} pending · {tasks.length} total
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <Plus size={14} /> New
        </Button>
      </div>

      <div className="flex gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              filter === f.id
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <CheckCircle2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {filter === 'pending' ? 'All caught up!' : 'No tasks here'}
          </p>
        </div>
      )}

      <Card className="divide-y-0 px-1">
        <AnimatePresence mode="popLayout">
          {filtered.map((task) => (
            <TaskItem
              key={task.id || task.task}
              task={task}
              onToggle={handleToggle}
              onUpdateItems={handleUpdateItems}
              onDelete={handleDelete}
              onEdit={setEditTask}
            />
          ))}
        </AnimatePresence>
      </Card>

      <AddTaskModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
      <EditTaskModal open={!!editTask} onClose={() => setEditTask(null)} onSave={handleEdit} task={editTask} />
    </div>
  )
}
