// Shared inline styles used by the automation wizard / editors.
// The select dropdown style is shared by many components, so it lives here
// to keep individual editors slim.

export const selectStyle = {
  width: '100%', height: 38, padding: '0 28px 0 10px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 9, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
}
