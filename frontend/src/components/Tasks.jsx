import { useState } from 'react'
import { useApi, postIntent } from '../hooks/useApi'

const PRIORITY_COLOR = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text-3)' }

function TaskRow({ task }) {
  const color = PRIORITY_COLOR[task.priority?.toLowerCase()] || 'var(--text-3)'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 16px', borderBottom: '1px solid var(--border-dim)',
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: 4, border: `2px solid var(--border)`,
        flexShrink: 0, marginTop: 2, cursor: 'pointer',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ color: 'var(--text)', fontSize: 14 }}>{task.task || task.text || JSON.stringify(task)}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          {task.due && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Due {task.due}</span>}
          {task.priority && <span style={{ fontSize: 11, color, fontWeight: 600 }}>{task.priority}</span>}
          {task.reminder && <span style={{ fontSize: 11, color: 'var(--teal)' }}>⏰ {task.reminder}</span>}
        </div>
      </div>
    </div>
  )
}

export function Tasks() {
  const { data, loading, refetch } = useApi('/api/tasks')
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)

  async function addTask() {
    if (!input.trim() || adding) return
    setAdding(true)
    await postIntent(`add task: ${input}`)
    setInput('')
    setTimeout(refetch, 800)
    setAdding(false)
  }

  const tasks = data?.tasks || []

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
          padding: '0 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
        }}>Add</button>
        <button onClick={refetch} style={{
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--text-2)', padding: '0 14px', borderRadius: 'var(--radius-sm)',
          cursor: 'pointer', fontSize: 13,
        }}>↻</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>Loading…</div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60, lineHeight: 2 }}>
            <div style={{ fontSize: 28 }}>✓</div>
            <div>No tasks yet</div>
          </div>
        ) : (
          tasks.map((t, i) => <TaskRow key={i} task={t} />)
        )}
      </div>

      <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-dim)', fontSize: 11, color: 'var(--text-3)' }}>
        {tasks.length} tasks
      </div>
    </div>
  )
}
