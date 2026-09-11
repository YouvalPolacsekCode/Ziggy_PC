// Shared onboarding step styles — used by both the native MobileOnboarding
// flow and the web/PWA WebOnboarding flow so the two look identical.

export const primaryBtn = {
  padding: '14px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent)',
  color: 'white',
  fontWeight: 600,
  fontSize: 15,
  cursor: 'pointer',
}

export const secondaryBtn = {
  ...primaryBtn,
  background: 'transparent',
  color: 'var(--ink-faint)',
  border: '1px solid var(--line)',
}

export const textInput = {
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--bg-2)',
  color: 'var(--ink)',
  fontSize: 15,
  fontFamily: 'inherit',
}

export const fieldLabel = {
  fontSize: 12,
  color: 'var(--ink-faint)',
  fontWeight: 500,
  marginBottom: -8,
}
