// Shared inline styles used by the automation wizard / editors.
// The select dropdown style is shared by many components, so it lives here
// to keep individual editors slim.
//
// HIG pass: the same geometry as components/ui/Select — 44px tall, Body
// (17px) type so iOS Safari never zooms on focus, control radius, and a
// line-drawn chevron in the ink-mute colour so it reads in both palettes.

export const selectStyle = {
  width: '100%', height: 44, padding: '0 36px 0 16px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-ctl)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 17,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='none' stroke='%236E5A48' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' d='M1 1.5l5 5 5-5'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
  transition: 'border-color var(--dur-press) var(--ease-standard)',
}

// Field label above a control: Subhead weight-600 in the secondary ink.
export const fieldLabelStyle = {
  display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4,
}

// Filter / selection chip. Active = surface-2 fill + ink + hairline (never
// inverted — inverted is reserved for the one primary action of a screen).
export const chipStyle = (active) => ({
  minHeight: 44, padding: '8px 16px', borderRadius: 999, fontSize: 15, fontWeight: 500,
  whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 8,
  background: active ? 'var(--surface-2)' : 'var(--surface)',
  color: active ? 'var(--ink)' : 'var(--ink-mute)',
  border: `0.5px solid ${active ? 'var(--line-2)' : 'var(--line)'}`,
  transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
})

// 44×44 borderless icon button used inside cards (run / view / delete).
export const cardIconBtn = (color = 'var(--ink-mute)') => ({
  background: 'none', border: 'none', cursor: 'pointer', color,
  width: 44, height: 44, padding: 0, borderRadius: 'var(--r-ctl)', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
})

// Soft informational box (replaces the tinted info/warn callouts).
export const noteBox = {
  padding: '12px 16px', borderRadius: 'var(--r-ctl)',
  background: 'var(--surface-2)', border: '0.5px solid var(--line)',
}
export const warnNoteBox = {
  padding: '12px 16px', borderRadius: 'var(--r-ctl)',
  background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))',
  border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))',
}
