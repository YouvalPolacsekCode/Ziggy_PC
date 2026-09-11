// The shell's own line icons — the bottom-nav tabs and the floating chat
// bubble draw from this one set so "Ziggy" looks the same everywhere it is
// tapped. Kept free of store imports on purpose: the chat bubble (and its
// tests) reuse the glyph without dragging BottomNav's auth/feature stores in.
// Default stroke 1.75 — the line weight every Lucide glyph carries at 18–24px,
// so the shell's own icons sit at the same weight as the rest of the app.
export function ZIcon({ name, size = 24, stroke = 1.75, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'home':    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>
    case 'rooms':   return <svg {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>
    case 'auto':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'devices': return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>
    case 'sparkle': return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>
    default: return null
  }
}

export default ZIcon
