import { useState } from 'react'
import { useApi, postIntent } from '../hooks/useApi'
import { addToast } from '../App'

const PRIORITY_COLOR = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text-3)' }
const FILTERS = ['all', 'pending', 'done', 'high']

function TaskRow({ task, onUpdate }) {
  const [acting, setActing] = useState(false)
  const isDone = task.done === true || task.status === 'done'
  const color = PRIORITY_COLOR[task.priority?.toLowerCase()] || 'var(--text-3)'

  async function toggleDone() {
    if (acting || isDone) return
    setActing(true)
    try {
      await postIntent(`mark task done: ${task.task || task.text}`)
      onUpdate()
    } catch {
      addToast('Failed to update task')
    } finally {
      setActing(false)
    }
  }

  async function deleteTask() {
    if (acting) return
    setActing(true)
    try {
      await postIntent(`remove task: ${task.task || task.text}`)
      onUpdate()
    } catch {
      addToast('Failed to delete task')
    } finally {
      setActing(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 16px', borderBottom: '1px solid var(--border-dim)',
      opacity: acting ? 0.5 : 1, transition: 'opacity .2s',
    }}>
      {/* Checkbox */}
      <div
        onClick={toggleDone}
        title={isDone ? 'Done' : 'Mark as done'}
        style={{
          width: 16, height: 16, borderRadius: 4,
          border: `2px solid ${isDone ? 'var(--green)' : 'var(--border)'}`,
          background: isDone ? 'var(--green)' : 'transparent',
          flexShrink: 0, marginTop: 2, cursor: isDone ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all .15s',
        }}
      >
        {isDone && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{
          color: isDone ? 'var(--text-3)' : 'var(--text)',
          fontSize: 14,
          textDecoration: isDone ? 'line-through' : 'none',
        }}>{task.task || task.text || JSON.stringify(task)}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          {task.due && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Due {task.due}</span>}
          {task.priority && <span style={{ fontSize: 11, color, fontWeight: 600 }}>{task.priority}</span>}
          {task.reminder && <span style={{ fontSize: 11, color: 'var(--teal)' }}>⏰ {task.reminder}</span>}
          {task.repeat && task.repeat !== 'none' && <span style={{ fontSize: 11, color: 'var(--indigo)' }}>↺ {task.repeat}</span>}
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={deleteTask}
        title="Delete task"
        style={{
          background: 'none', border: 'none', color: 'var(--text-3)',
          cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1,
          transition: 'color .15s', flexShrink: 0,
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
      >×</button>
    </div>
  )
}

export function Tasks() {
  const { data, loading, refetch } = useApi('/api/tasks')
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('all')

  async function addTask() {
    if (!input.trim() || adding) return
    setAdding(true)
    try {
      await postIntent(`add task: ${input}`)
      setInput('')
      await refetch()
    } catch {
      addToast('Failed to add task')
    } finally {
      setAdding(false)
    }
  }

  const allTasks = data?.tasks || []
  const tasks = allTasks.filter(t => {
    if (filter === 'all') return true
    if (filter === 'pending') return !t.done && t.status !== 'done'
    if (filter === 'done') return t.done || t.status === 'done'
    if (filter === 'high') return t.priority?.toLowerCase() === 'high'
    return true
  })

  const pendingCount = allTasks.filter(t => !t.done && t.status !== 'done').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Add task bar */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', gap: 10 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          placeholder="Add a task…"
          style={{
            flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 12px',
            fontSize: 14, outline: 'none', fontFamily: 'var(--font)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--purple)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <button onClick={addTask} disabled={adding} style={{
          background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
          color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
          padding: '0 18px', cursor: adding ? 'not-allowed' : 'pointer',
          fontWeight: 600, fontSize: 13, opacity: adding ? 0.6 : 1,
        }}>{adding ? '…' : 'Add'}</button>
        <button onClick={refetch} style={{
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--text-2)', padding: '0 14px', borderRadius: 'var(--radius-sm)',
          cursor: 'pointer', fontSize: 13,
        }}>↻</button>
      </div>

      {/* Filter tabs */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', gap: 6 }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? 'var(--purple-dim)' : 'transparent',
            border: `1px solid ${filter === f ? 'var(--purple-mid)' : 'transparent'}`,
            color: filter === f ? 'var(--purple)' : 'var(--text-3)',
            padding: '3px 10px', borderRadius: 20,
            fontSize: 12, cursor: 'pointer', transition: 'all .15s', textTransform: 'capitalize',
          }}>
            {f}{f === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>Loading…</div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60, lineHeight: 2 }}>
            <div style={{ fontSize: 28 }}>✓</div>
            <div>{filter === 'all' ? 'No tasks yet — add one above' : `No ${filter} tasks`}</div>
          </div>
        ) : (
          tasks.map(t => (
            <TaskRow
              key={`${t.task || t.text}-${t.created || ''}`}
              task={t}
              onUpdate={() => setTimeout(refetch, 500)}
            />
          ))
        )}
      </div>

      <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-dim)', fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 16 }}>
        <span>{pendingCount} pending</span>
        <span>{allTasks.length - pendingCount} done</span>
      </div>
    </div>
  )
}
