import { useState, useEffect, useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/Sidebar'
import { Console } from './components/Console'
import { Devices } from './components/Devices'
import { Tasks } from './components/Tasks'
import { Memory } from './components/Memory'
import { Settings } from './components/Settings'
import { Visualizer } from './components/Visualizer'

const SECTIONS = {
  console:    Console,
  visualizer: Visualizer,
  devices:    Devices,
  tasks:      Tasks,
  memory:     Memory,
  settings:   Settings,
}

const TITLES = {
  console:    'Console',
  visualizer: 'Ziggy Core',
  devices:    'Devices',
  tasks:      'Tasks',
  memory:     'Memory',
  settings:   'Settings',
}

const SECTION_KEYS = Object.keys(SECTIONS)

// Global toast store
let _addToast = null
export function addToast(msg, type = 'error') {
  _addToast?.(msg, type)
}

function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      display: 'flex', flexDirection: 'column', gap: 8,
      zIndex: 9999, maxWidth: 360,
    }}>
      {toasts.map(t => (
        <div key={t.id} className="fade-in" style={{
          background: t.type === 'error' ? '#ef444422' : '#22c55e22',
          border: `1px solid ${t.type === 'error' ? '#ef444466' : '#22c55e66'}`,
          color: t.type === 'error' ? 'var(--red)' : 'var(--green)',
          borderRadius: 'var(--radius)',
          padding: '10px 14px',
          fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: 'var(--shadow-lg)',
        }}>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <button onClick={() => dismiss(t.id)} style={{
            background: 'none', border: 'none', color: 'inherit',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
            opacity: 0.7,
          }}>×</button>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const { messages, connected } = useWebSocket()
  const [section, setSection] = useState('console')
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), [])

  const addToastLocal = useCallback((msg, type = 'error') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  // Expose toast adder globally
  useEffect(() => { _addToast = addToastLocal; return () => { _addToast = null } }, [addToastLocal])

  // Keyboard navigation: Ctrl+1..6 switches sections
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        if (SECTION_KEYS[idx]) setSection(SECTION_KEYS[idx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const Section = SECTIONS[section]

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      <Sidebar active={section} onChange={setSection} connected={connected} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <header style={{
          height: 52,
          display: 'flex', alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--border-dim)',
          background: 'var(--bg-1)',
          gap: 12,
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>
            {TITLES[section]}
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected ? 'var(--green)' : 'var(--red)',
              boxShadow: connected ? '0 0 6px var(--green)' : 'none',
              transition: 'all .3s',
            }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {connected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
        </header>

        {/* Main content — only Console and Visualizer receive messages */}
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {section === 'console' && <Console messages={messages} />}
          {section === 'visualizer' && <Visualizer messages={messages} connected={connected} />}
          {section !== 'console' && section !== 'visualizer' && <Section />}
        </main>
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </div>
  )
}
