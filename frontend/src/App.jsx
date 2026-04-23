import { useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/Sidebar'
import { Console } from './components/Console'
import { Devices } from './components/Devices'
import { Tasks } from './components/Tasks'
import { Memory } from './components/Memory'
import { Settings } from './components/Settings'

const SECTIONS = {
  console:  Console,
  devices:  Devices,
  tasks:    Tasks,
  memory:   Memory,
  settings: Settings,
}

const TITLES = {
  console:  'Console',
  devices:  'Devices',
  tasks:    'Tasks',
  memory:   'Memory',
  settings: 'Settings',
}

export default function App() {
  const { messages, connected } = useWebSocket()
  const [section, setSection] = useState('console')
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

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Section messages={messages} />
        </main>
      </div>
    </div>
  )
}
