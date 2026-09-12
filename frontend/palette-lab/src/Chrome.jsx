// The concept's own chrome: status line, navigation, assistant affordance.
//
// Navigation is one of the loudest signals of what a front end IS, so it is
// DNA-driven rather than fixed. A floating pill reads as an app that wants to
// feel light; a bottom bar reads as a utility; a top row with a rule under it
// reads as a document or an instrument. All three carry the same five
// destinations, so nothing is being compared unfairly — only the treatment
// differs.

import { usePal, Icon, Text } from './ui'
import { NOW } from './data'

export const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'rooms', label: 'Rooms', icon: 'grid' },
  { id: 'assistant', label: 'Ziggy', icon: 'chat' },
  { id: 'device', label: 'Devices', icon: 'light' },
  { id: 'actions', label: 'Actions', icon: 'bolt' },
]

export function StatusLine({ wide }) {
  const p = usePal()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: wide ? `10px ${p.space.gutter}px` : '8px 16px',
      fontFamily: p.type.mono, fontSize: p.type.micro,
      color: p.c.inkFaint, letterSpacing: '0.04em',
    }}>
      <span>{NOW}</span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span>LTE</span><span>84%</span>
      </span>
    </div>
  )
}

function TabButton({ tab, active, onClick, vertical }) {
  const p = usePal()
  // The active tab's ink must be chosen from whatever is actually BEHIND it.
  //
  // This was wrong and it was visible: Spring + Teal and Cyprus + Sand both use
  // a solid dark colour as `onTint`, so painting the active label with `c.ink`
  // (also dark) made the selected tab vanish into its own pill. A fill and the
  // text on that fill are a pair; read them as a pair.
  const filled = p.nav === 'floating'
  const tinted = !filled && !(p.tile === 'outline' || p.border === 'hard')
  const activeBg = filled
    ? (p.grad.accentBtn || p.c.accent)
    : tinted ? p.c.onTint : 'transparent'
  const col = !active
    ? p.c.inkFaint
    : filled ? p.c.accentInk
      : tinted ? p.c.onInk   // the ink that belongs to onTint, never body ink
        : p.c.ink            // nothing behind it, so body ink is correct

  return (
    <button
      onClick={onClick}
      style={{
        flex: vertical ? 'none' : 1,
        display: 'flex', flexDirection: vertical ? 'row' : 'column',
        alignItems: 'center', justifyContent: vertical ? 'flex-start' : 'center',
        gap: vertical ? 12 : 4,
        padding: vertical ? '11px 14px' : '8px 4px',
        background: active ? activeBg : 'transparent',
        border: p.border === 'hard' && active && !vertical
          ? `0 0 2px 0 solid` : '1px solid transparent',
        borderBottom: p.border === 'hard' && active && !vertical ? `2px solid ${p.c.accent}` : undefined,
        borderRadius: p.nav === 'floating' ? p.shape.pill : p.shape.ctl,
        color: col, cursor: 'pointer', minWidth: 0,
        fontFamily: p.type.body,
      }}
    >
      <Icon name={tab.icon} size={vertical ? 19 : 20} color={col} />
      <span style={{
        fontSize: p.type.micro, fontWeight: active ? 750 : 550,
        textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
        color: col, whiteSpace: 'nowrap',
      }}>{tab.label}</span>
    </button>
  )
}

// ── Mobile navigation ───────────────────────────────────────────────────

export function MobileNav({ screen, onScreen }) {
  const p = usePal()
  const floating = p.nav === 'floating'

  if (p.nav === 'top') {
    return (
      <div style={{
        display: 'flex', gap: 2, padding: '0 12px',
        borderBottom: `1px solid ${p.c.line}`,
        background: p.c.bg, flexShrink: 0,
      }}>
        {TABS.map((t) => (
          <TabButton key={t.id} tab={t} active={screen === t.id} onClick={() => onScreen(t.id)} />
        ))}
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: floating ? '0 14px 14px' : 0, flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', gap: floating ? 4 : 0,
        padding: floating ? 6 : '6px 8px calc(6px + env(safe-area-inset-bottom))',
        background: floating ? p.c.surface : p.c.surface,
        borderRadius: floating ? p.shape.pill : 0,
        border: floating ? `1px solid ${p.c.line}` : 'none',
        borderTop: floating ? `1px solid ${p.c.line}` : `1px solid ${p.c.line}`,
        boxShadow: floating ? (p.depth.raised === 'none' ? 'none' : p.depth.raised) : 'none',
        backdropFilter: p.tile === 'glass' ? 'blur(18px)' : undefined,
      }}>
        {TABS.map((t) => (
          <TabButton key={t.id} tab={t} active={screen === t.id} onClick={() => onScreen(t.id)} />
        ))}
      </div>
    </div>
  )
}

// ── Desktop rail ────────────────────────────────────────────────────────

export function DesktopRail({ screen, onScreen }) {
  const p = usePal()
  return (
    <aside style={{
      width: 210, flexShrink: 0, padding: `${p.space.gutter}px 12px`,
      background: p.tile === 'glass' ? 'transparent' : p.c.bgAlt,
      borderRight: `1px solid ${p.c.line}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontFamily: p.type.display, fontSize: 19, fontWeight: p.type.displayWeight,
        color: p.c.ink, padding: '4px 12px 18px', letterSpacing: p.type.tracking,
      }}>
        Ziggy<span style={{ color: p.c.accent }}>.</span>
      </div>
      {TABS.map((t) => (
        <TabButton key={t.id} tab={t} active={screen === t.id} onClick={() => onScreen(t.id)} vertical />
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ padding: '0 12px' }}>
        <Text faint size={p.type.micro}>8 of 38 active</Text>
      </div>
    </aside>
  )
}

// The assistant affordance. Floating-nav palettes get a circular button that
// sits above the pill; everything else folds it into the nav row.
export function AssistantBubble({ onClick, offsetForNav }) {
  const p = usePal()
  if (p.nav !== 'floating') return null
  return (
    <button
      onClick={onClick}
      aria-label="Ask Ziggy"
      style={{
        position: 'absolute', insetInlineEnd: 18, bottom: offsetForNav,
        width: 52, height: 52, borderRadius: p.shape.pill,
        background: p.grad.accentBtn || p.c.accent,
        color: p.c.accentInk, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: p.depth.raised === 'none' ? 'none' : p.depth.raised,
      }}
    >
      <Icon name="star" size={24} color={p.c.accentInk} />
    </button>
  )
}
