// Shared onboarding step styles — used by both the native MobileOnboarding
// flow and the web/PWA WebOnboarding flow so the two look identical.
//
// These mirror the .z-btn-primary / .z-btn-secondary / .z-input classes in
// index.css (Body 17, 44px min target, one radius). Kept as style objects so
// a step can spread them (`{ ...primaryBtn, flex: 2 }`) without a wrapper.
// The primary button is ink-on-bg (the screen's one inverted element); the
// brand accent is never a button fill here.

export const primaryBtn = {
  minHeight: 44,
  padding: '12px 20px',
  borderRadius: 'var(--r-ctl)',
  border: 'none',
  background: 'var(--ink)',
  color: 'var(--bg)',
  fontWeight: 600,
  fontSize: 17,
  lineHeight: 1.2,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  transition: 'background var(--dur-press) var(--ease-standard)',
}

export const secondaryBtn = {
  ...primaryBtn,
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '0.5px solid var(--line)',
}

export const textInput = {
  minHeight: 44,
  padding: '12px 16px',
  borderRadius: 'var(--r-ctl)',
  border: '0.5px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 17,
  lineHeight: 1.3,
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

// Pairing / claim codes: big, bold, tracked, always LTR.
export const codeInput = {
  ...textInput,
  fontSize: 34,
  fontWeight: 700,
  lineHeight: '41px',
  letterSpacing: '0.2em',
  textAlign: 'center',
  direction: 'ltr',
  fontVariantNumeric: 'tabular-nums',
}

export const fieldLabel = {
  fontSize: 15,
  lineHeight: '20px',
  color: 'var(--ink)',
  fontWeight: 600,
  marginBottom: -4,
}
