// Motion Lab — a stage that renders the prototype inside Ziggy's real palette
// (data-palette drives every CSS variable), sized like a phone, a tablet or
// the full width, depending on the global frame control.
//
// Tablet (768+) and desktop frames render the app's real shell around the
// prototype: the 240 px sidebar with the real nav, no bottom nav, the page's
// wider grid. `kind="fixed"` pins a phone-only interaction (bottom nav,
// sheets, swipe-back) to a 390 px phone whatever the frame. `bare` skips the
// shell for prototypes that draw their own (the sidebar demo).
import { useLab } from '../LabContext'
import { Icon, useT } from '../ziggy/primitives'

const SIDE = [
  { key: 'home', icon: 'house', label: { en: 'Home', he: 'בית' } },
  { key: 'rooms', icon: 'layout-grid', label: { en: 'Rooms', he: 'חדרים' } },
  { key: 'chat', icon: 'sparkles', label: { en: 'Ask Ziggy', he: 'שאל את זיגי' } },
  { key: 'devices', icon: 'lightbulb', label: { en: 'Devices', he: 'מכשירים' } },
  { key: 'actions', icon: 'zap', label: { en: 'Actions', he: 'פעולות' } },
]
const SIDE2 = [
  { key: 'alerts', icon: 'bell', label: { en: 'Alerts', he: 'התראות' } },
  { key: 'settings', icon: 'settings', label: { en: 'Settings', he: 'הגדרות' } },
]

function Sidebar({ active = 'home' }) {
  const t = useT()
  const Item = ({ item }) => (
    <div className={`zl-side__item ${item.key === active ? 'is-active' : ''}`}><Icon name={item.icon} size={20} strokeWidth={item.key === active ? 2.2 : 1.7} /><span>{t(item.label)}</span></div>
  )
  return (
    <aside className="zl zl-side" aria-hidden>
      <div className="zl-side__brand"><span className="ml-brand__mark" style={{ width: 24, height: 24, fontSize: 12, borderRadius: 7 }}>Z</span><span className="zl-headline">Ziggy</span><span className="zl-dot" data-state="occupied" style={{ marginInlineStart: 'auto' }} /></div>
      <div className="zl-side__group">{SIDE.map(i => <Item key={i.key} item={i} />)}</div>
      <div className="zl-side__group" style={{ marginTop: 8 }}>{SIDE2.map(i => <Item key={i.key} item={i} />)}</div>
      <div className="zl-side__foot"><span className="zl-caption zl-mute">{t({ en: 'Connected · Canary', he: 'מחובר · Canary' })}</span></div>
    </aside>
  )
}

export function Stage({ kind = 'phone', height, bare = false, activeNav = 'home', children }) {
  const { theme, frameWidth, frame, speed, dir } = useLab()
  const fixed = kind === 'fixed'
  const isPhone = frame === 'phone' || fixed
  const width = fixed ? 390 : frameWidth
  const h = height ?? (isPhone ? 640 : 600)
  const shell = !isPhone && !bare
  return (
    <div className={`ml-stage ml-stage--${isPhone ? 'phone' : frame}`} style={{ '--lab-speed': 1 / speed }}>
      <div
        className={`ml-stage__frame ${isPhone ? 'ml-stage__frame--phone' : ''}`}
        data-palette={theme}
        data-frame={isPhone ? 'phone' : frame}
        dir={dir}
        style={{ width: width ? `${width}px` : '100%', height: `${h}px` }}
      >
        {shell ? (
          <div className="zl zl-shell">
            <Sidebar active={activeNav} />
            <div className="zl-shell__main">{children}</div>
          </div>
        ) : children}
      </div>
    </div>
  )
}
