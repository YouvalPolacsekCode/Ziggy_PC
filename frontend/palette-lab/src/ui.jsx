// Palette-driven primitives.
//
// Every screen is built from these, and every one of them reads the DNA rather
// than hard-coding a look. That is what makes ten concepts out of one codebase
// honest: the screens describe STRUCTURE ("a tile showing a room, which is
// occupied"), and the palette decides whether that tile is a glass panel with a
// teal glow, a hairline rectangle with uppercase micro-type, or a fat rounded
// solid with a warm gradient.
//
// If you find yourself writing a colour literal in a screen, it belongs here or
// in palettes.js instead.

import { createContext, useContext } from 'react'

const PaletteCtx = createContext(null)
export const PaletteProvider = PaletteCtx.Provider
export const usePal = () => useContext(PaletteCtx)

// ── Surface construction ────────────────────────────────────────────────
// The `tile` and `border` DNA decide how a panel is actually built. These are
// genuinely different constructions, not one construction with a different
// fill: an outline palette has no shadow and a real hairline, a glass palette
// has a translucent fill plus backdrop blur, a tinted palette replaces
// elevation with a wash of colour.

export function surfaceStyle(p, { active = false, raised = false, flat = false } = {}) {
  const s = {
    borderRadius: p.shape.card,
    transition: 'background 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
  }

  if (p.tile === 'glass') {
    s.background = active && p.grad.activeTile ? p.grad.activeTile : p.c.surface
    s.backdropFilter = 'blur(14px)'
    s.WebkitBackdropFilter = 'blur(14px)'
    s.border = `1px solid ${active ? p.c.lineStrong : p.c.line}`
    s.boxShadow = flat ? 'none' : (raised ? p.depth.raised : p.depth.card)
  } else if (p.tile === 'outline') {
    s.background = active ? p.c.surface2 : p.c.surface
    s.border = `1px solid ${active ? p.c.lineStrong : p.c.line}`
    s.boxShadow = flat ? 'none' : p.depth.card
  } else if (p.tile === 'tinted') {
    s.background = active && p.grad.activeTile ? p.grad.activeTile : (active ? p.c.onTint : p.c.surface)
    s.border = `1px solid ${active ? 'transparent' : p.c.line}`
    s.boxShadow = 'none'
  } else {
    // solid
    s.background = active && p.grad.activeTile ? p.grad.activeTile : (active ? p.c.surface2 : p.c.surface)
    s.border = p.border === 'none' ? '1px solid transparent' : `1px solid ${p.c.line}`
    s.boxShadow = flat ? 'none' : (raised ? p.depth.raised : p.depth.card)
  }

  if (p.border === 'gold' && active) s.border = `1px solid ${p.c.lineStrong}`
  if (p.border === 'glow' && active && p.c.onGlow !== 'none') {
    s.boxShadow = `0 0 0 1px ${p.c.lineStrong}, 0 10px 34px ${p.c.onGlow}`
  }
  return s
}

export function Card({ children, active, raised, flat, pad = true, style, ...rest }) {
  const p = usePal()
  return (
    <div
      style={{
        ...surfaceStyle(p, { active, raised, flat }),
        padding: pad ? p.space.cardPad : 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

// ── Type ────────────────────────────────────────────────────────────────

export function H1({ children, style }) {
  const p = usePal()
  return (
    <h1 style={{
      margin: 0, fontFamily: p.type.display, fontSize: p.type.h1,
      fontWeight: p.type.displayWeight, letterSpacing: p.type.tracking,
      lineHeight: 1.08, color: p.c.ink, ...style,
    }}>{children}</h1>
  )
}

export function H2({ children, style }) {
  const p = usePal()
  return (
    <h2 style={{
      margin: 0, fontFamily: p.type.display, fontSize: p.type.h2,
      fontWeight: p.type.displayWeight, letterSpacing: p.type.tracking,
      lineHeight: 1.2, color: p.c.ink, ...style,
    }}>{children}</h2>
  )
}

export function Text({ children, mute, faint, size, weight, mono, style }) {
  const p = usePal()
  return (
    <span style={{
      fontFamily: mono ? p.type.mono : p.type.body,
      fontSize: size || p.type.base,
      fontWeight: weight || p.type.bodyWeight,
      color: faint ? p.c.inkFaint : mute ? p.c.inkMute : p.c.ink,
      letterSpacing: mono ? '0' : p.type.tracking,
      lineHeight: 1.35,
      ...style,
    }}>{children}</span>
  )
}

// The section label is one of the loudest palette tells: SMALL CAPS WITH WIDE
// TRACKING reads editorial, sentence case reads friendly.
export function Label({ children, style }) {
  const p = usePal()
  return (
    <div style={{
      fontFamily: p.type.body, fontSize: p.type.micro,
      fontWeight: 650, color: p.c.inkFaint,
      textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
      marginBottom: 10, ...style,
    }}>{children}</div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────

export function Btn({ children, primary, ghost, small, style, ...rest }) {
  const p = usePal()
  const base = {
    fontFamily: p.type.body, fontWeight: 650, fontSize: small ? p.type.small : p.type.base,
    borderRadius: p.shape.ctl, padding: small ? '8px 12px' : '11px 16px',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
    letterSpacing: p.type.labelCase === 'uppercase' ? p.type.labelTrack : p.type.tracking,
    textTransform: p.type.labelCase === 'uppercase' ? 'uppercase' : 'none',
    transition: 'background 140ms ease, color 140ms ease, border-color 140ms ease',
  }
  if (primary) {
    return <button style={{
      ...base,
      background: p.grad.accentBtn || p.c.accent,
      color: p.c.accentInk, border: '1px solid transparent',
      boxShadow: p.depth.card === 'none' ? 'none' : p.depth.card,
      ...style,
    }} {...rest}>{children}</button>
  }
  if (ghost) {
    return <button style={{
      ...base, background: 'transparent', color: p.c.inkMute,
      border: '1px solid transparent', ...style,
    }} {...rest}>{children}</button>
  }
  return <button style={{
    ...base, background: p.c.surface, color: p.c.ink,
    border: `1px solid ${p.c.line}`, ...style,
  }} {...rest}>{children}</button>
}

export function Chip({ children, active, style, ...rest }) {
  const p = usePal()
  return (
    <span style={{
      fontFamily: p.type.body, fontSize: p.type.micro, fontWeight: 650,
      textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
      padding: '5px 10px', borderRadius: p.shape.pill,
      background: active ? p.c.onTint : 'transparent',
      color: active ? p.c.onInk : p.c.inkMute,
      border: `1px solid ${active ? 'transparent' : p.c.line}`,
      whiteSpace: 'nowrap', ...style,
    }} {...rest}>{children}</span>
  )
}

// ── State ───────────────────────────────────────────────────────────────
// How a room says occupied / empty / unknown. `unknown` is deliberately its
// own treatment everywhere — never styled as a quieter `empty`.

export function OccDot({ state, style }) {
  const p = usePal()
  const fill = state === 'occupied' ? p.c.good : state === 'unknown' ? p.c.warn : p.c.inkFaint
  const common = { width: 8, height: 8, flexShrink: 0, ...style }
  if (state === 'unknown') {
    // Hollow: an outline is "no reading", which a filled dot cannot say.
    return <span style={{ ...common, borderRadius: 999, border: `2px solid ${fill}` }} />
  }
  return (
    <span style={{
      ...common, borderRadius: p.shape.tile <= 4 ? 0 : 999, background: fill,
      boxShadow: state === 'occupied' && p.c.onGlow !== 'none' ? `0 0 0 4px ${p.c.onGlow}` : 'none',
    }} />
  )
}

// The on/off expression itself is a palette decision. A colourless palette
// has to say it with fill and weight; a glow palette says it with light.
export function StateBadge({ on, state, children, style }) {
  const p = usePal()
  const isUnknown = state === 'unknown'
  const bg = isUnknown ? 'transparent' : on ? p.c.onTint : 'transparent'
  const fg = isUnknown ? p.c.warn : on ? p.c.onInk : p.c.inkFaint
  return (
    <span style={{
      fontFamily: p.type.body, fontSize: p.type.micro, fontWeight: on ? 750 : 600,
      textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
      padding: '4px 9px', borderRadius: p.shape.pill,
      background: bg, color: fg,
      border: `1px solid ${isUnknown ? p.c.warn : on ? 'transparent' : p.c.line}`,
      ...style,
    }}>{children}</span>
  )
}

// A level bar. Sharp palettes get a square bar, round ones a pill.
export function Bar({ value = 0, style }) {
  const p = usePal()
  return (
    <div style={{
      height: p.shape.ctl <= 4 ? 6 : 8, borderRadius: p.shape.pill,
      background: p.c.surface2, overflow: 'hidden',
      border: p.border === 'hard' ? `1px solid ${p.c.line}` : 'none', ...style,
    }}>
      <div style={{
        width: `${value}%`, height: '100%', borderRadius: p.shape.pill,
        background: p.grad.accentBtn || p.c.accent,
      }} />
    </div>
  )
}

// ── Icons ───────────────────────────────────────────────────────────────
// One geometry, four renderings. `filled` is a solid glyph, `outline` a
// 1.75 stroke, `thin` a 1 stroke, `duotone` a stroke over a soft fill.

const PATHS = {
  light: 'M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-4 11.6c.8.7 1.2 1.7 1.2 2.6v.3h5.6v-.3c0-.9.4-1.9 1.2-2.6A6.5 6.5 0 0 0 12 2.5z',
  tv: 'M3 5.5h18v12H3zM8 21.5h8',
  // A thermometer, not the arrow-into-a-line this used to be — at 18px that
  // read as a download glyph, which is a bad thing for the icon on your air
  // conditioner to look like. Closed shape, so it also fills correctly for the
  // palettes that draw solid icons.
  climate: 'M14.2 13.6V5.2a2.2 2.2 0 1 0-4.4 0v8.4a4.2 4.2 0 1 0 4.4 0z',
  plug: 'M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3',
  cover: 'M3 4h18M6 4v9M12 4v13M18 4v9M3 21h18',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v10h-13z',
  water: 'M12 3s6 6.6 6 10.4A6 6 0 0 1 6 13.4C6 9.6 12 3 12 3z',
  room: 'M4 10.5 12 4l8 6.5V20H4z',
  chat: 'M4 5h16v11H9l-5 4z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 5.5v-3M12 21.5v-3M5.5 12h-3M21.5 12h-3M7 7 5 5M19 19l-2-2M17 7l2-2M5 19l2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9',
  play: 'M8 5l11 7-11 7z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  home: 'M4 10.5 12 4l8 6.5V20H4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',
  back: 'M15 5l-7 7 7 7',
}

export function Icon({ name, size = 20, color, style }) {
  const p = usePal()
  const d = PATHS[name] || PATHS.room
  const col = color || p.c.ink
  const mode = p.icons
  // Only closed shapes go in the filled list. An open path (the fan, the
  // cover's slats) filled solid becomes an inkblot, so those stay stroked even
  // in a palette that draws solid icons — a deliberate exception, not an
  // oversight.
  if (mode === 'filled' && ['light', 'moon', 'play', 'bolt', 'star', 'room', 'home', 'water', 'climate'].includes(name)) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, ...style }} aria-hidden="true">
        <path d={d} fill={col} stroke={col} strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  }
  const sw = mode === 'thin' ? 1 : mode === 'outline' ? 1.6 : 1.9
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...style }} aria-hidden="true">
      {mode === 'duotone' && (
        <path d={d} fill={col} opacity="0.16" stroke="none" />
      )}
      <path d={d} stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The little square that holds a device icon — another strong palette tell.
export function IconWell({ name, on, size = 38, style }) {
  const p = usePal()
  const col = on ? p.c.onInk : p.c.inkMute
  return (
    <div style={{
      width: size, height: size, borderRadius: p.shape.ctl,
      background: on ? (p.grad.activeTile || p.c.onTint) : p.c.surface2,
      border: p.border === 'hard' ? `1px solid ${on ? p.c.lineStrong : p.c.line}` : '1px solid transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: on && p.c.onGlow !== 'none' ? `0 0 18px ${p.c.onGlow}` : 'none',
      flexShrink: 0, ...style,
    }}>
      <Icon name={name} size={Math.round(size * 0.52)} color={col} />
    </div>
  )
}

// ── Layout helpers ──────────────────────────────────────────────────────

// A Row is spacing WITHIN a thing (icon to label); a Stack is the rhythm
// BETWEEN things (row to row). They were both reading `space.gap`, which is why
// Pearl + Charcoal — whose list rhythm is a deliberate 1px hairline stack — was
// also jamming every icon against its own label. Those are two different
// decisions and now have two different tokens.
export function Row({ children, gap, align = 'center', justify, style }) {
  const p = usePal()
  return (
    <div style={{
      display: 'flex', alignItems: align, justifyContent: justify,
      gap: gap ?? p.space.inline ?? p.space.gap, minWidth: 0, ...style,
    }}>{children}</div>
  )
}

export function Stack({ children, gap, style }) {
  const p = usePal()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: gap ?? p.space.gap, minWidth: 0, ...style }}>
      {children}
    </div>
  )
}

export function Section({ label, children, style }) {
  const p = usePal()
  return (
    <section style={{ marginBottom: p.space.section, ...style }}>
      {label && <Label>{label}</Label>}
      {children}
    </section>
  )
}
