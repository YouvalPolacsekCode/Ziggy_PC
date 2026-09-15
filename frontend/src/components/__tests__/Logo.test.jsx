import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// The real store persists through zustand, and this environment has no
// localStorage — the language itself is all these tests need.
const langRef = vi.hoisted(() => ({ current: 'en' }))
vi.mock('../../lib/i18n', () => ({ useLang: () => langRef.current }))

const Logo = (await import('../ui/Logo')).default
const { LOGO_ART } = await import('../ui/Logo')
const setLang = (l) => { langRef.current = l }

afterEach(cleanup)

describe('Logo', () => {
  it('serves each approved variant from a stable public path', () => {
    for (const variant of Object.keys(LOGO_ART)) {
      cleanup()
      render(<Logo variant={variant} tone="light" height={80} />)
      expect(screen.getByRole('img')).toHaveAttribute('src', `/brand/ziggy-${variant}.svg`)
    }
  })

  it('uses the reversed artwork on dark surfaces', () => {
    render(<Logo variant="bilingual" tone="dark" height={80} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/ziggy-bilingual-dark.svg')
  })

  it('emits both artworks under tone="auto" so CSS can follow the painted surface', () => {
    const { container } = render(<Logo variant="symbol" height={40} />)
    expect(container.querySelector('.ziggy-logo-light')).toHaveAttribute('src', '/brand/ziggy-symbol.svg')
    expect(container.querySelector('.ziggy-logo-dark')).toHaveAttribute('src', '/brand/ziggy-symbol-dark.svg')
  })

  it('keeps the artwork aspect ratio rather than stretching it', () => {
    render(<Logo variant="bilingual" tone="light" height={100} />)
    const img = screen.getByRole('img')
    expect(Number(img.getAttribute('width'))).toBe(Math.round(100 * LOGO_ART.bilingual.ratio))
    expect(img).toHaveStyle({ width: 'auto', height: '100px' })
  })

  it('never mirrors under RTL — the Hebrew is drawn, not laid out', () => {
    document.documentElement.dir = 'rtl'
    render(<Logo variant="bilingual" tone="light" height={40} />)
    expect(screen.getByRole('img')).toHaveStyle({ transform: 'none' })
    document.documentElement.dir = 'ltr'
  })

  it('names the brand for assistive tech, biscript for the lockups', () => {
    render(<Logo variant="bilingual" tone="light" height={40} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Ziggy · זיגי')
  })

  it('is presentational when the brand is already named nearby', () => {
    const { container } = render(<Logo variant="symbol" tone="light" height={40} decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('warns instead of silently resizing below the legibility floor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Logo variant="bilingual" tone="light" height={12} />)
    // Height is honoured; shrinking a caller's logo breaks their layout.
    expect(screen.getByRole('img')).toHaveStyle({ height: '12px' })
    if (import.meta.env?.DEV) expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('floors both scripts at the same letter height, not the same width', () => {
    // Matching widths would draw זיגי ~1.5x taller than ZIGGY and overpower it.
    expect(LOGO_ART.hebrew.minHeight).toBe(LOGO_ART.english.minHeight)
    expect(LOGO_ART.hebrew.ratio).toBeLessThan(LOGO_ART.english.ratio)
  })
})

describe('Logo — language-aware wordmark', () => {
  it('draws the English wordmark while the app is in English', () => {
    setLang('en')
    render(<Logo variant="wordmark" tone="light" height={37} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/ziggy-english.svg')
  })

  it('draws the Hebrew wordmark while the app is in Hebrew', () => {
    setLang('he')
    render(<Logo variant="wordmark" tone="light" height={37} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/ziggy-hebrew.svg')
    setLang('en')
  })

  it('follows a language switch on re-render', () => {
    setLang('en')
    const { rerender } = render(<Logo variant="wordmark" tone="light" height={37} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/ziggy-english.svg')
    setLang('he')
    rerender(<Logo variant="wordmark" tone="light" height={37} key="x" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/ziggy-hebrew.svg')
    setLang('en')
  })

  it('draws either script at the sidebar size without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const l of ['en', 'he']) {
      cleanup()
      setLang(l)
      render(<Logo variant="wordmark" tone="light" height={37} />)
    }
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    setLang('en')
  })
})
