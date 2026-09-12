// The ten directions.
//
// A palette here is NOT a set of colours. If it were, all ten screens would be
// the same screen ten times and the comparison would be worthless — you would
// be choosing a hue, not a front end.
//
// So each entry carries a whole design DNA: colour, yes, but also the shape
// language (how round), the density (how much air), the type system (which
// face, which scale, which case), the depth model (shadow, or hairline, or
// nothing), whether gradients exist at all, how an icon is drawn, where
// navigation lives, how a card is constructed, and — the one that matters most
// in a smart-home app — how a device says it is ON.
//
// The screens read these and build themselves. Two palettes therefore differ
// in proportion, weight, rhythm and construction, not only in colour.
//
// The colours you supplied are `swatch`, kept verbatim and shown in the UI.
// Everything else in `c` is derived to make a working interface: a palette of
// two colours still needs a disabled state, a hairline and three levels of
// text, and inventing those IS the design work.

export const PALETTES = [
  {
    id: 'warm-amber',
    name: 'Warm Amber',
    swatch: ['#FFDF9E', '#FBBA00', '#E5781E', '#5A3D2B'],
    thesis: 'A hearth. Everything is warm, soft and lit from within; the home glows rather than reports.',
    mode: 'light',
    c: {
      bg: '#FFF8EC', bgAlt: '#FFF1DC',
      surface: '#FFFFFF', surface2: '#FFF3DC',
      ink: '#5A3D2B', inkMute: '#8A6B52', inkFaint: '#B29377',
      line: '#F0DFC2', lineStrong: '#E5C994',
      accent: '#E5781E', accentInk: '#FFFFFF',
      onTint: '#FFDF9E', onInk: '#5A3D2B', onGlow: 'rgba(251,186,0,0.38)',
      good: '#7A9A3C', warn: '#E5781E',
      // Ink that survives ON the hero gradient. Premium Corporate is why this
      // exists: its hero is deep navy and its body ink is dark graphite, so the
      // headline was very nearly invisible on the one element meant to carry it.
      heroInk: '#5A3D2B', heroInkMute: 'rgba(90,61,43,0.72)',
    },
    shape: { card: 22, tile: 20, ctl: 14, pill: 999, sheet: 28 },
    space: { gutter: 20, cardPad: 18, gap: 14, section: 30 , inline: 14 },
    type: {
      display: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 34, h2: 20, base: 15, small: 13, micro: 11,
      displayWeight: 600, bodyWeight: 500,
      tracking: '-0.01em', labelCase: 'none', labelTrack: '0.02em',
    },
    depth: {
      card: '0 6px 20px rgba(90,61,43,0.09)',
      raised: '0 12px 34px rgba(90,61,43,0.14)',
      inset: 'inset 0 1px 0 rgba(255,255,255,0.7)',
    },
    grad: {
      hero: 'linear-gradient(160deg, #FFDF9E 0%, #FBBA00 55%, #E5781E 120%)',
      activeTile: 'radial-gradient(120% 120% at 22% 12%, rgba(255,223,158,0.95) 0%, rgba(251,186,0,0.55) 55%, rgba(229,120,30,0.20) 100%)',
      accentBtn: 'linear-gradient(180deg, #F08A2E 0%, #E5781E 100%)',
    },
    icons: 'filled', nav: 'floating', tile: 'solid', border: 'soft',
  },

  {
    id: 'prussian-orange',
    name: 'Prussian Orange',
    swatch: ['#000000', '#14213D', '#FCA311', '#FFFFFF', '#C2C4C3'],
    thesis: 'An instrument panel. Hard edges, no shadows, information ranked by type weight and rule lines.',
    mode: 'dark',
    c: {
      bg: '#000000', bgAlt: '#080C16',
      surface: '#14213D', surface2: '#0D1628',
      ink: '#FFFFFF', inkMute: '#C2C4C3', inkFaint: '#6E7686',
      line: '#223052', lineStrong: '#33456F',
      accent: '#FCA311', accentInk: '#000000',
      onTint: '#FCA311', onInk: '#000000', onGlow: 'none',
      good: '#FCA311', warn: '#FCA311',
    },
    shape: { card: 3, tile: 3, ctl: 2, pill: 3, sheet: 4 },
    space: { gutter: 18, cardPad: 14, gap: 8, section: 26 , inline: 10 },
    type: {
      display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 40, h2: 17, base: 14, small: 12, micro: 10,
      displayWeight: 800, bodyWeight: 500,
      tracking: '-0.03em', labelCase: 'uppercase', labelTrack: '0.14em',
    },
    depth: { card: 'none', raised: 'none', inset: 'none' },
    grad: { hero: null, activeTile: null, accentBtn: null },
    icons: 'outline', nav: 'top', tile: 'outline', border: 'hard',
  },

  {
    id: 'midnight-turquoise',
    name: 'Midnight Turquoise',
    swatch: ['#071317', '#02A0A0', '#FFBD65'],
    thesis: 'Night operations. Deep black-green glass, everything live glows teal, amber is reserved for what needs you.',
    mode: 'dark',
    c: {
      bg: '#071317', bgAlt: '#04090B',
      surface: 'rgba(13,32,38,0.92)', surface2: '#102A31',
      ink: '#E6F4F5', inkMute: '#8FB3B6', inkFaint: '#4F7276',
      line: '#17353D', lineStrong: '#215059',
      accent: '#02A0A0', accentInk: '#03191B',
      onTint: 'rgba(2,160,160,0.18)', onInk: '#5FE9E9', onGlow: 'rgba(2,160,160,0.45)',
      good: '#02A0A0', warn: '#FFBD65',
      // Ink that survives ON the hero gradient. Premium Corporate is why this
      // exists: its hero is deep navy and its body ink is dark graphite, so the
      // headline was very nearly invisible on the one element meant to carry it.
      heroInk: '#E6F4F5', heroInkMute: 'rgba(230,244,245,0.66)',
    },
    shape: { card: 16, tile: 16, ctl: 12, pill: 999, sheet: 22 },
    space: { gutter: 18, cardPad: 16, gap: 12, section: 26 , inline: 12 },
    type: {
      display: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 32, h2: 18, base: 14, small: 12, micro: 10,
      displayWeight: 650, bodyWeight: 500,
      tracking: '-0.015em', labelCase: 'uppercase', labelTrack: '0.1em',
    },
    depth: {
      card: '0 0 0 1px rgba(2,160,160,0.10), 0 14px 40px rgba(0,0,0,0.55)',
      raised: '0 0 0 1px rgba(2,160,160,0.22), 0 20px 60px rgba(0,0,0,0.7)',
      inset: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    },
    grad: {
      hero: 'linear-gradient(150deg, rgba(2,160,160,0.35) 0%, rgba(7,19,23,0.1) 70%)',
      activeTile: 'radial-gradient(130% 130% at 15% 0%, rgba(2,160,160,0.40) 0%, rgba(2,160,160,0.08) 60%, transparent 100%)',
      accentBtn: 'linear-gradient(180deg, #04B8B8 0%, #02A0A0 100%)',
    },
    icons: 'duotone', nav: 'floating', tile: 'glass', border: 'glow',
  },

  {
    id: 'premium-corporate',
    name: 'Premium Corporate',
    swatch: ['#2D3436', '#0A3D62', '#D4AF37', '#F9F9F9'],
    thesis: 'Quiet money. Serif headings, thin gold rules, almost no shadow; restraint reads as expensive.',
    mode: 'light',
    c: {
      bg: '#F9F9F9', bgAlt: '#F1F2F3',
      surface: '#FFFFFF', surface2: '#F1F2F3',
      ink: '#2D3436', inkMute: '#6B7476', inkFaint: '#A3ACAE',
      line: '#E2E5E6', lineStrong: '#D4AF37',
      accent: '#0A3D62', accentInk: '#FFFFFF',
      onTint: 'rgba(212,175,55,0.14)', onInk: '#8A6D14', onGlow: 'none',
      good: '#0A3D62', warn: '#B4791A',
      // Ink that survives ON the hero gradient. Premium Corporate is why this
      // exists: its hero is deep navy and its body ink is dark graphite, so the
      // headline was very nearly invisible on the one element meant to carry it.
      heroInk: '#FFFFFF', heroInkMute: 'rgba(255,255,255,0.74)',
    },
    shape: { card: 8, tile: 6, ctl: 4, pill: 4, sheet: 10 },
    space: { gutter: 24, cardPad: 20, gap: 14, section: 34 , inline: 14 },
    type: {
      display: 'Georgia, "Times New Roman", serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 33, h2: 19, base: 14, small: 12, micro: 10,
      displayWeight: 500, bodyWeight: 500,
      tracking: '0', labelCase: 'uppercase', labelTrack: '0.16em',
    },
    depth: {
      card: '0 1px 2px rgba(45,52,54,0.06)',
      raised: '0 4px 14px rgba(45,52,54,0.10)',
      inset: 'none',
    },
    grad: { hero: 'linear-gradient(180deg, #0A3D62 0%, #082F4C 100%)', activeTile: null, accentBtn: null },
    icons: 'thin', nav: 'top', tile: 'outline', border: 'gold',
  },

  {
    id: 'fresh-signal',
    name: 'Fresh Signal',
    swatch: ['#B7F3D0', '#E7FFF2', '#111418', '#707981', '#25C77A'],
    thesis: 'Clean product energy. Mint tints do the work shadows usually do; state is loud, chrome is silent.',
    mode: 'light',
    c: {
      bg: '#E7FFF2', bgAlt: '#D8FBE7',
      surface: '#FFFFFF', surface2: '#D8FBE7',
      ink: '#111418', inkMute: '#707981', inkFaint: '#A7AEB3',
      line: '#C6EFD8', lineStrong: '#25C77A',
      accent: '#25C77A', accentInk: '#04220F',
      onTint: '#B7F3D0', onInk: '#0B6B3C', onGlow: 'none',
      good: '#25C77A', warn: '#E8A13A',
      // Ink that survives ON the hero gradient. Premium Corporate is why this
      // exists: its hero is deep navy and its body ink is dark graphite, so the
      // headline was very nearly invisible on the one element meant to carry it.
      heroInk: '#111418', heroInkMute: 'rgba(17,20,24,0.64)',
    },
    shape: { card: 16, tile: 14, ctl: 10, pill: 999, sheet: 20 },
    space: { gutter: 18, cardPad: 16, gap: 12, section: 26 , inline: 12 },
    type: {
      display: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 31, h2: 18, base: 14, small: 12, micro: 10,
      displayWeight: 750, bodyWeight: 550,
      tracking: '-0.02em', labelCase: 'none', labelTrack: '0.02em',
    },
    depth: { card: 'none', raised: '0 8px 24px rgba(17,20,24,0.08)', inset: 'none' },
    grad: {
      hero: 'linear-gradient(150deg, #B7F3D0 0%, #E7FFF2 70%)',
      activeTile: 'linear-gradient(160deg, #B7F3D0 0%, #8FE9BA 100%)',
      accentBtn: null,
    },
    icons: 'filled', nav: 'bar', tile: 'tinted', border: 'soft',
  },

  {
    id: 'mint-plum',
    name: 'Mint + Plum',
    swatch: ['#4FFFB0', '#3D1A4E'],
    thesis: 'Two colours and nothing else. No greys to hide behind, so hierarchy comes from scale and pills of pure mint.',
    mode: 'dark',
    c: {
      bg: '#2A1236', bgAlt: '#210E2B',
      surface: '#3D1A4E', surface2: '#4A2160',
      ink: '#F6ECFB', inkMute: '#BFA3D2', inkFaint: '#8465A0',
      line: '#562A6E', lineStrong: '#6B3888',
      accent: '#4FFFB0', accentInk: '#14082B',
      onTint: 'rgba(79,255,176,0.16)', onInk: '#4FFFB0', onGlow: 'rgba(79,255,176,0.35)',
      good: '#4FFFB0', warn: '#FFD166',
      // Ink that survives ON the hero gradient. Premium Corporate is why this
      // exists: its hero is deep navy and its body ink is dark graphite, so the
      // headline was very nearly invisible on the one element meant to carry it.
      heroInk: '#F6ECFB', heroInkMute: 'rgba(246,236,251,0.68)',
    },
    shape: { card: 24, tile: 22, ctl: 999, pill: 999, sheet: 30 },
    space: { gutter: 20, cardPad: 18, gap: 12, section: 30 , inline: 12 },
    type: {
      display: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 42, h2: 21, base: 15, small: 13, micro: 11,
      displayWeight: 800, bodyWeight: 550,
      tracking: '-0.04em', labelCase: 'uppercase', labelTrack: '0.12em',
    },
    depth: { card: 'none', raised: '0 18px 50px rgba(0,0,0,0.45)', inset: 'none' },
    grad: {
      hero: 'linear-gradient(160deg, #4A2160 0%, #2A1236 100%)',
      activeTile: 'linear-gradient(150deg, rgba(79,255,176,0.30) 0%, rgba(79,255,176,0.04) 100%)',
      accentBtn: 'linear-gradient(180deg, #6BFFC0 0%, #4FFFB0 100%)',
    },
    icons: 'filled', nav: 'floating', tile: 'solid', border: 'none',
  },

  {
    id: 'pearl-charcoal',
    name: 'Pearl + Charcoal',
    swatch: ['#F5F6F7', '#2F2F33'],
    thesis: 'No colour at all. A device proves it is on by weight and fill, which forces the typography to carry everything.',
    mode: 'light',
    c: {
      bg: '#F5F6F7', bgAlt: '#EDEEF0',
      surface: '#FFFFFF', surface2: '#EDEEF0',
      ink: '#2F2F33', inkMute: '#6E7075', inkFaint: '#A6A8AD',
      line: '#E0E2E5', lineStrong: '#2F2F33',
      accent: '#2F2F33', accentInk: '#FFFFFF',
      onTint: '#2F2F33', onInk: '#FFFFFF', onGlow: 'none',
      good: '#2F2F33', warn: '#2F2F33',
    },
    shape: { card: 2, tile: 2, ctl: 2, pill: 2, sheet: 2 },
    space: { gutter: 20, cardPad: 16, gap: 1, section: 28 , inline: 10 },
    type: {
      display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 30, h2: 16, base: 13, small: 11, micro: 9,
      displayWeight: 700, bodyWeight: 500,
      tracking: '-0.02em', labelCase: 'uppercase', labelTrack: '0.18em',
    },
    depth: { card: 'none', raised: 'none', inset: 'none' },
    grad: { hero: null, activeTile: null, accentBtn: null },
    icons: 'outline', nav: 'top', tile: 'outline', border: 'hard',
  },

  {
    id: 'spring-teal',
    name: 'Spring + Teal',
    swatch: ['#DFE0C3', '#344C4B'],
    thesis: 'Matte and papery. Sage ground, deep teal ink, no shadow anywhere — it reads like a well-set book.',
    mode: 'light',
    c: {
      bg: '#DFE0C3', bgAlt: '#D3D5B4',
      surface: '#EAEBD6', surface2: '#D3D5B4',
      ink: '#344C4B', inkMute: '#5E7574', inkFaint: '#8A9C9B',
      line: '#C5C8A6', lineStrong: '#344C4B',
      accent: '#344C4B', accentInk: '#EAEBD6',
      onTint: '#344C4B', onInk: '#EAEBD6', onGlow: 'none',
      good: '#4A6B57', warn: '#9A6B34',
    },
    shape: { card: 18, tile: 16, ctl: 12, pill: 999, sheet: 22 },
    space: { gutter: 22, cardPad: 18, gap: 14, section: 32 , inline: 14 },
    type: {
      display: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 32, h2: 19, base: 14, small: 12, micro: 10,
      displayWeight: 600, bodyWeight: 500,
      tracking: '-0.005em', labelCase: 'none', labelTrack: '0.08em',
    },
    depth: { card: 'none', raised: 'none', inset: 'none' },
    grad: { hero: null, activeTile: null, accentBtn: null },
    icons: 'outline', nav: 'bar', tile: 'solid', border: 'soft',
  },

  {
    id: 'soft-amber',
    name: 'Soft Amber',
    swatch: ['#474150', '#F5FFF4', '#9C99B8', '#FFBB00'],
    thesis: 'Dusk indoors. Violet-grey structure, a mint-white ground, and amber saved entirely for what is live.',
    mode: 'light',
    c: {
      bg: '#F5FFF4', bgAlt: '#EFF2EE',
      surface: '#FFFFFF', surface2: '#EFEEF6',
      ink: '#474150', inkMute: '#6F6A7D', inkFaint: '#9C99B8',
      line: '#E3E1EC', lineStrong: '#9C99B8',
      accent: '#FFBB00', accentInk: '#474150',
      onTint: 'rgba(255,187,0,0.20)', onInk: '#8A6A00', onGlow: 'rgba(255,187,0,0.30)',
      good: '#6FA07A', warn: '#FFBB00',
      // Ink that survives ON the hero gradient. Premium Corporate is why this
      // exists: its hero is deep navy and its body ink is dark graphite, so the
      // headline was very nearly invisible on the one element meant to carry it.
      heroInk: '#474150', heroInkMute: 'rgba(71,65,80,0.70)',
    },
    shape: { card: 18, tile: 16, ctl: 12, pill: 999, sheet: 24 },
    space: { gutter: 20, cardPad: 17, gap: 13, section: 28 , inline: 13 },
    type: {
      display: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 32, h2: 18, base: 14, small: 12, micro: 10,
      displayWeight: 680, bodyWeight: 520,
      tracking: '-0.015em', labelCase: 'none', labelTrack: '0.04em',
    },
    depth: {
      card: '0 4px 18px rgba(156,153,184,0.22)',
      raised: '0 12px 32px rgba(71,65,80,0.16)',
      inset: 'none',
    },
    grad: {
      hero: 'linear-gradient(155deg, #EFEEF6 0%, #F5FFF4 100%)',
      activeTile: 'radial-gradient(120% 120% at 18% 8%, rgba(255,187,0,0.34) 0%, rgba(255,187,0,0.06) 70%, transparent 100%)',
      accentBtn: 'linear-gradient(180deg, #FFC93A 0%, #FFBB00 100%)',
    },
    icons: 'filled', nav: 'floating', tile: 'solid', border: 'soft',
  },

  {
    id: 'cyprus-sand',
    name: 'Cyprus + Sand',
    swatch: ['#004741', '#F0EDE4'],
    thesis: 'Forest on paper. Editorial spacing, serif headings and a single deep green doing every job.',
    mode: 'light',
    c: {
      bg: '#F0EDE4', bgAlt: '#E4E0D3',
      surface: '#FAF8F2', surface2: '#E4E0D3',
      ink: '#004741', inkMute: '#3D6B66', inkFaint: '#7E948F',
      line: '#DAD5C6', lineStrong: '#004741',
      accent: '#004741', accentInk: '#F0EDE4',
      onTint: '#004741', onInk: '#F0EDE4', onGlow: 'none',
      good: '#004741', warn: '#A4632A',
    },
    shape: { card: 12, tile: 10, ctl: 8, pill: 999, sheet: 16 },
    space: { gutter: 26, cardPad: 20, gap: 16, section: 36 , inline: 16 },
    type: {
      display: 'Georgia, "Times New Roman", serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      h1: 36, h2: 20, base: 14, small: 12, micro: 10,
      displayWeight: 500, bodyWeight: 500,
      tracking: '-0.01em', labelCase: 'uppercase', labelTrack: '0.15em',
    },
    depth: { card: 'none', raised: '0 6px 20px rgba(0,71,65,0.10)', inset: 'none' },
    grad: { hero: null, activeTile: null, accentBtn: null },
    icons: 'outline', nav: 'top', tile: 'outline', border: 'soft',
  },
]

export const byId = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0]
export const indexOf = (id) => Math.max(0, PALETTES.findIndex((p) => p.id === id))
