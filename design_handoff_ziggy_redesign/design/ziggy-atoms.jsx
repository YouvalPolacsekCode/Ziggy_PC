// ── Ziggy shared atoms (icons, phone shell, controls) ─────────────────────
// All visual primitives reused across screens. Pure presentational.

// ───────────────────────────────────────────────────────────────────────
// Icon library — minimal, line-based, 1.6 stroke, original drawings
// ───────────────────────────────────────────────────────────────────────
function ZIcon({ name, size = 18, stroke = 1.6, color = 'currentColor' }) {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    // navigation
    case 'home':    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>;
    case 'rooms':   return <svg {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>;
    case 'auto':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
    case 'chat':    return <svg {...p}><path d="M3 12a8 8 0 1 1 3.2 6.4L3 20l1.4-3.2A8 8 0 0 1 3 12z"/></svg>;
    case 'alerts':  return <svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case 'menu':    return <svg {...p}><path d="M4 6h16M4 12h16M4 18h16"/></svg>;
    case 'plus':    return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'search':  return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
    case 'mic':     return <svg {...p}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>;
    case 'back':    return <svg {...p}><path d="M15 18l-6-6 6-6"/></svg>;
    case 'fwd':     return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case 'down':    return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
    case 'up':      return <svg {...p}><path d="M6 15l6-6 6 6"/></svg>;
    case 'more':    return <svg {...p}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>;
    case 'close':   return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'check':   return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
    case 'star':    return <svg {...p}><path d="M12 2l2.6 7H22l-6 4.7 2.4 7.3L12 16.5 5.6 21 8 13.7 2 9h7.4z"/></svg>;
    case 'gear':    return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1c.5.5 1.3.6 1.8.3.6-.2 1-.8 1-1.5V3a2 2 0 1 1 4 0v.1c0 .7.4 1.3 1 1.5.5.3 1.3.2 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.2.6.8 1 1.5 1H21a2 2 0 1 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/></svg>;
    // domains
    case 'light':   return <svg {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>;
    case 'climate': return <svg {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/></svg>;
    case 'fan':     return <svg {...p}><path d="M12 12a4 4 0 0 0-4-4 4 4 0 0 0 4 4zM12 12a4 4 0 0 1 4 4 4 4 0 0 1-4-4zM12 12a4 4 0 0 0 4-4 4 4 0 0 0-4 4zM12 12a4 4 0 0 1-4 4 4 4 0 0 1 4-4z"/></svg>;
    case 'media':   return <svg {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>;
    case 'play':    return <svg {...p} fill={color}><path d="M6 4l14 8-14 8z" stroke="none"/></svg>;
    case 'pause':   return <svg {...p} fill={color}><rect x="6" y="4" width="4" height="16" stroke="none"/><rect x="14" y="4" width="4" height="16" stroke="none"/></svg>;
    case 'lock':    return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>;
    case 'unlock':  return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0"/></svg>;
    case 'motion':  return <svg {...p}><circle cx="12" cy="5" r="2"/><path d="M8 22l2-6 2 2 2-2 2 6M9 12l3 3 3-3"/></svg>;
    case 'door':    return <svg {...p}><rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="0.7" fill={color}/></svg>;
    case 'window':  return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/></svg>;
    case 'camera':  return <svg {...p}><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></svg>;
    case 'temp':    return <svg {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/></svg>;
    case 'humid':   return <svg {...p}><path d="M12 2.5s6 7 6 11.5a6 6 0 0 1-12 0c0-4.5 6-11.5 6-11.5z"/></svg>;
    case 'wind':    return <svg {...p}><path d="M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2"/></svg>;
    case 'tv':      return <svg {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/></svg>;
    case 'volume':  return <svg {...p}><path d="M3 9v6h4l5 4V5L7 9zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/></svg>;
    case 'shield':  return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case 'sun':     return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case 'moon':    return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;
    case 'leaf':    return <svg {...p}><path d="M11 20A7 7 0 0 1 4 13c0-6 5-10 17-10 0 12-4 17-10 17z"/><path d="M2 22l8-8"/></svg>;
    case 'bolt':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
    case 'sparkle': return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>;
    case 'family':  return <svg {...p}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 2-3 3-3s3 1 3 3"/></svg>;
    case 'wifi':    return <svg {...p}><path d="M2 9a16 16 0 0 1 20 0M5 13a11 11 0 0 1 14 0M8.5 16.5a6 6 0 0 1 7 0M12 20h.01"/></svg>;
    case 'flame':   return <svg {...p}><path d="M12 2c1 5 6 7 6 12a6 6 0 1 1-12 0c0-3 2-4 2-7s2-3 4-5z"/></svg>;
    case 'remote':  return <svg {...p}><rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="1.5"/><path d="M10 14h4M10 17h4"/></svg>;
    case 'plug':    return <svg {...p}><path d="M9 2v6M15 2v6"/><path d="M5 8h14v3a7 7 0 0 1-14 0z"/><path d="M12 18v4"/></svg>;
    case 'mute':    return <svg {...p}><path d="M3 9v6h4l5 4V5L7 9zM22 9l-6 6M16 9l6 6"/></svg>;
    case 'sliders': return <svg {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2" fill={color}/><circle cx="12" cy="10" r="2" fill={color}/><circle cx="20" cy="14" r="2" fill={color}/></svg>;
    case 'sunset':  return <svg {...p}><circle cx="12" cy="13" r="3"/><path d="M12 3v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20M12 19v3"/></svg>;
    case 'sunrise': return <svg {...p}><circle cx="12" cy="13" r="3"/><path d="M12 4v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20"/></svg>;
    case 'route':   return <svg {...p}><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V8a4 4 0 0 1 8 0v8a4 4 0 0 0 4-4"/></svg>;
    case 'water':   return <svg {...p}><path d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13z"/></svg>;
    case 'key':     return <svg {...p}><circle cx="7" cy="15" r="4"/><path d="M10 12l11-11M16 7l3 3M14 9l3 3"/></svg>;
    case 'globe':   return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a16 16 0 0 1 0 20a16 16 0 0 1 0-20"/></svg>;
    case 'eye':     return <svg {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>;
    default:        return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Phone shell — pure visual chrome
// ───────────────────────────────────────────────────────────────────────
function PhoneShell({ children, time = '9:41', height = 800 }) {
  return (
    <div className="z-phone" style={{ height }}>
      <div className="z-phone-screen">
        <div className="z-statusbar">
          <span>{time}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <ZIcon name="wifi" size={13} color="var(--ink)" />
            <span style={{ display: 'inline-block', width: 22, height: 11, borderRadius: 3, border: '1px solid var(--ink)', position: 'relative', padding: 1 }}>
              <span style={{ position: 'absolute', inset: 1, background: 'var(--ink)', borderRadius: 1, width: 'calc(100% - 6px)' }} />
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Status pip — uniform little colored dot+label
// ───────────────────────────────────────────────────────────────────────
function StatusPip({ kind = 'on', label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-mute)' }}>
      <span className={`z-dot z-dot-${kind}`} />
      {label}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Eyebrow + line caption helper
// ───────────────────────────────────────────────────────────────────────
function Eyebrow({ children, style }) {
  return <div className="z-eyebrow" style={style}>{children}</div>;
}

// ───────────────────────────────────────────────────────────────────────
// Tile button — used in dashboards
// ───────────────────────────────────────────────────────────────────────
function ControlTile({ icon, label, sub, on, accentColor }) {
  return (
    <div style={{
      padding: 14, borderRadius: 18,
      background: on ? 'var(--ink)' : 'var(--surface)',
      color: on ? 'var(--bg)' : 'var(--ink)',
      border: '0.5px solid var(--line)',
      display: 'flex', flexDirection: 'column', gap: 14,
      minHeight: 96,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: on ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: on ? (accentColor || 'var(--accent)') : 'var(--ink-2)',
        }}>
          <ZIcon name={icon} size={16} />
        </div>
        <span style={{
          width: 28, height: 16, borderRadius: 999,
          background: on ? (accentColor || 'var(--accent)') : 'var(--line-2)',
          position: 'relative', display: 'inline-block',
        }}>
          <span style={{
            position: 'absolute', top: 2, left: on ? 14 : 2,
            width: 12, height: 12, borderRadius: '50%', background: '#fff',
            transition: 'left 0.15s',
          }} />
        </span>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: on ? 'color-mix(in srgb, var(--bg) 70%, transparent)' : 'var(--ink-faint)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Bottom nav (mobile)
// ───────────────────────────────────────────────────────────────────────
function BottomNav({ active = 'home' }) {
  const items = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'rooms', label: 'Rooms', icon: 'rooms' },
    { id: 'chat', label: 'Ask', icon: 'sparkle' },
    { id: 'devices', label: 'Devices', icon: 'plug' },
    { id: 'auto', label: 'Automate', icon: 'auto' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '10px 12px 22px',
      background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
      backdropFilter: 'blur(20px)',
      borderTop: '0.5px solid var(--line)',
      display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end',
    }}>
      {items.map(it => (
        <div key={it.id} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          color: active === it.id ? 'var(--ink)' : 'var(--ink-faint)',
          fontSize: 10, fontWeight: 500, letterSpacing: '0.01em',
        }}>
          <ZIcon name={it.icon} size={20} stroke={active === it.id ? 1.9 : 1.5} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Big circular brightness/temp dial — visual only
// ───────────────────────────────────────────────────────────────────────
function Dial({ size = 240, value = 70, max = 100, label, sublabel, color = 'var(--accent)', trackColor = 'var(--line)' }) {
  const r = size / 2 - 18;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / max);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth="14" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      }}>
        <div style={{ fontSize: size * 0.22, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1 }}>{label}</div>
        {sublabel && <div className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, letterSpacing: '0.04em' }}>{sublabel}</div>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Image-placeholder (subtly striped panel)
// ───────────────────────────────────────────────────────────────────────
function ImgPlaceholder({ width = '100%', height = 120, label, radius = 12 }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background:
        'repeating-linear-gradient(135deg, var(--surface-3) 0 8px, var(--surface-2) 8px 16px)',
      border: '0.5px solid var(--line)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, color: 'var(--ink-faint)',
      letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>{label}</div>
  );
}

// Expose to globals
Object.assign(window, {
  ZIcon, PhoneShell, StatusPip, Eyebrow, ControlTile, BottomNav, Dial, ImgPlaceholder,
});
