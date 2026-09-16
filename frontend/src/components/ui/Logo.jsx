// The one place that knows how to draw the Ziggy brand.
//
// Artwork is the approved biscript identity: English ZIGGY + Hebrew זיגי sharing
// one symbol, black/warm-white with the orange accent. Files live in
// `public/brand/` under fixed names, so replacing the artwork is a file copy —
// nothing in this component or its callers needs to change.
//
// Rules the artwork carries (do not work around them in callers):
//   - never rebuild a wordmark out of live type
//   - never stretch, rotate, recolor, outline or shadow it
//   - never mirror it under RTL — Hebrew is part of the drawing, not a layout
//   - keep the English–Hebrew order of the lockup as drawn

import { useLang } from '../../lib/i18n'

// Intrinsic viewBox ratios. Height is what callers set; width follows from
// these so the lockup can never be stretched.
//
// `minHeight` is the legibility floor, expressed as drawn height rather than
// width. The approved board states it as width ("Wordmark 120px+"), but that
// number is English-shaped: זיגי is far squarer than ZIGGY, so matching widths
// draws the Hebrew roughly 1.5× taller and it visibly overpowers the English.
// Equal height is what makes the two scripts read at the same weight, so the
// floor is the height 120px of English works out to — 37px — applied to both.
//
// These warn in development rather than clamping: silently resizing a logo
// blows out the layout it was placed in, which is worse than drawing it small.
const ART = {
  bilingual: { ratio: 631 / 114, minHeight: 37, label: 'Ziggy · זיגי' },
  stacked:   { ratio: 372 / 222, minHeight: 72, label: 'Ziggy · זיגי' },
  english:   { ratio: 372 / 114, minHeight: 37, label: 'Ziggy' },
  hebrew:    { ratio: 205 / 98,  minHeight: 37, label: 'זיגי' },
  symbol:    { ratio: 114 / 112, minHeight: 16, label: 'Ziggy' },
}

const warned = new Set()

/**
 * @param {'bilingual'|'stacked'|'english'|'hebrew'|'symbol'|'wordmark'} variant
 *        'wordmark' is the single-language one: it draws זיגי while the app is
 *        in Hebrew and ZIGGY otherwise. Inside the app the interface is already
 *        committed to one language, which is the context the brand rules
 *        reserve a standalone wordmark for. The bilingual lockup stays the
 *        signature on language-neutral surfaces like sign-in.
 * @param {number} height    drawn height in px; width follows the artwork ratio
 * @param {'auto'|'light'|'dark'|'invert'} tone
 *        which *surface* the logo sits on — 'light' picks the black artwork,
 *        'dark' the reversed warm-white one.
 *
 *        'auto' resolves in CSS from the nearest `[data-palette]` ancestor
 *        rather than from the theme store, because the two can legitimately
 *        disagree: LoginPage and the marketing site pin themselves to
 *        `data-palette="dark"` whatever the user's theme is. Keying off the
 *        attribute that actually paints the surface is what stops the black
 *        wordmark being drawn on a black background.
 * @param {boolean} decorative  true when the brand is already named nearby;
 *        renders the mark as presentational instead of repeating it to AT.
 */
export default function Logo({
  variant = 'bilingual',
  height,
  tone = 'auto',
  decorative = false,
  className = '',
  style,
  ...rest
}) {
  const lang = useLang()
  // Resolved before anything else so the rest of the component only ever deals
  // in real artwork names.
  const key = variant === 'wordmark' ? (lang === 'he' ? 'hebrew' : 'english') : variant
  const art = ART[key] || ART.bilingual

  const h = height ?? art.minHeight
  const w = h * art.ratio

  if (import.meta.env?.DEV && h < art.minHeight && !warned.has(key + h)) {
    warned.add(key + h)
    console.warn(
      `[Logo] "${key}" is drawn ${h}px tall, below its ${art.minHeight}px ` +
      `legibility floor. Use a more compact variant (e.g. "symbol") rather ` +
      `than drawing this one smaller.`,
    )
  }

  const common = {
    alt: decorative ? '' : art.label,
    'aria-hidden': decorative || undefined,
    role: decorative ? 'presentation' : 'img',
    width: Math.round(w),
    height: Math.round(h),
    draggable: false,
    style: {
      height: h,
      width: 'auto',
      // RTL must not flip the artwork: the Hebrew is drawn, not laid out.
      transform: 'none',
      flexShrink: 0,
      ...style,
    },
    ...rest,
  }

  const src = (dark) => `/brand/ziggy-${key}${dark ? '-dark' : ''}.svg`

  if (tone !== 'auto' && tone !== 'invert') {
    return <img src={src(tone === 'dark')} className={className} {...common} />
  }

  // Both are emitted; CSS shows exactly one, so only the visible image reaches
  // the accessibility tree (`display:none` removes the other).
  //
  // 'invert' swaps which artwork each class carries, for a mark sitting on a
  // filled surface that already opposes the palette — the chat button is
  // `background: var(--ink)`, so it is dark while the page is light. The CSS
  // rules are untouched; only the file behind each class changes.
  const flip = tone === 'invert'
  return (
    <>
      <img src={src(flip)}  className={`ziggy-logo-light ${className}`} {...common} />
      <img src={src(!flip)} className={`ziggy-logo-dark ${className}`}  {...common} />
    </>
  )
}

export { ART as LOGO_ART }
