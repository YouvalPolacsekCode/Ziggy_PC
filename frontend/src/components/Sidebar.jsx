const NAV = [
  { id: 'console',  icon: '◈', label: 'Console'  },
  { id: 'devices',  icon: '⌂', label: 'Devices'  },
  { id: 'tasks',    icon: '✓', label: 'Tasks'    },
  { id: 'memory',   icon: '◉', label: 'Memory'   },
  { id: 'settings', icon: '⚙', label: 'Settings' },
]

export function Sidebar({ active, onChange, connected }) {
  return (
    <aside style={{
      width: 64,
      background: 'var(--bg-1)',
      borderRight: '1px solid var(--border-dim)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 16,
      gap: 4,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        width: 36, height: 36,
        borderRadius: 10,
        background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700, color: '#fff',
        marginBottom: 20,
        boxShadow: 'var(--glow)',
      }}>Z</div>

      {NAV.map(item => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          title={item.label}
          style={{
            width: 44, height: 44,
            borderRadius: 'var(--radius)',
            background: active === item.id ? 'var(--purple-dim)' : 'transparent',
            border: active === item.id ? '1px solid var(--purple-mid)' : '1px solid transparent',
            color: active === item.id ? 'var(--purple)' : 'var(--text-3)',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all .15s',
          }}
        >{item.icon}</button>
      ))}

      {/* Connection dot at bottom */}
      <div style={{ flex: 1 }} />
      <div style={{
        width: 8, height: 8,
        borderRadius: '50%',
        background: connected ? 'var(--green)' : 'var(--red)',
        marginBottom: 16,
        boxShadow: connected ? '0 0 8px var(--green)' : 'none',
        transition: 'all .3s',
      }} title={connected ? 'Connected' : 'Disconnected'} />
    </aside>
  )
}
