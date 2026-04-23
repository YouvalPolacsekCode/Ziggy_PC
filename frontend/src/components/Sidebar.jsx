import { useState } from 'react'

const NAV = [
  { id: 'console',    icon: '◈', label: 'Console'   },
  { id: 'visualizer', icon: '◎', label: 'Core'      },
  { id: 'devices',    icon: '⌂', label: 'Devices'   },
  { id: 'tasks',      icon: '✓', label: 'Tasks'     },
  { id: 'memory',     icon: '◉', label: 'Memory'    },
  { id: 'settings',   icon: '⚙', label: 'Settings'  },
]

export function Sidebar({ active, onChange, connected }) {
  const [expanded, setExpanded] = useState(false)
  const width = expanded ? 130 : 64

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        width,
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--border-dim)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 16,
        gap: 4,
        flexShrink: 0,
        transition: 'width .2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <div style={{
        width: 36, height: 36,
        borderRadius: 10,
        background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700, color: '#fff',
        marginBottom: 20,
        boxShadow: 'var(--glow)',
        flexShrink: 0,
      }}>Z</div>

      {NAV.map(item => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          title={expanded ? undefined : item.label}
          style={{
            width: expanded ? 110 : 44,
            height: 44,
            borderRadius: 'var(--radius)',
            background: active === item.id ? 'var(--purple-dim)' : 'transparent',
            border: active === item.id ? '1px solid var(--purple-mid)' : '1px solid transparent',
            color: active === item.id ? 'var(--purple)' : 'var(--text-3)',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center',
            justifyContent: expanded ? 'flex-start' : 'center',
            paddingLeft: expanded ? 12 : 0,
            gap: expanded ? 10 : 0,
            transition: 'all .15s',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
          {expanded && (
            <span style={{ fontSize: 13, fontWeight: active === item.id ? 600 : 400, overflow: 'hidden' }}>
              {item.label}
            </span>
          )}
        </button>
      ))}

      {/* Connection dot at bottom */}
      <div style={{ flex: 1 }} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 16, paddingLeft: expanded ? 12 : 0,
        width: expanded ? 110 : 'auto',
        transition: 'all .2s',
      }}>
        <div style={{
          width: 8, height: 8,
          borderRadius: '50%',
          background: connected ? 'var(--green)' : 'var(--red)',
          boxShadow: connected ? '0 0 8px var(--green)' : 'none',
          transition: 'all .3s',
          flexShrink: 0,
        }} title={connected ? 'Connected' : 'Disconnected'} />
        {expanded && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {connected ? 'Connected' : 'Offline'}
          </span>
        )}
      </div>
    </aside>
  )
}
