/** @type {import('tailwindcss').Config} */
// All colors below resolve through CSS custom properties defined in
// `src/index.css` and switch automatically with `[data-palette="dark"]`. Never
// hardcode hex values here — the variable is the source of truth so Tailwind
// classes and inline `var(--…)` styles always render the same pixel.
export default {
  darkMode: ['selector', '[data-palette="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg:          'var(--bg)',
        'bg-2':      'var(--bg-2)',
        'bg-3':      'var(--bg-3)',
        surface:     'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        ink:         'var(--ink)',
        'ink-2':     'var(--ink-2)',
        'ink-mute':  'var(--ink-mute)',
        'ink-faint': 'var(--ink-faint)',
        'ink-ghost': 'var(--ink-ghost)',
        line:        'var(--line)',
        'line-2':    'var(--line-2)',
        'line-3':    'var(--line-3)',
        accent:      'var(--accent)',
        'accent-2':  'var(--accent-2)',
        'accent-3':  'var(--accent-3)',
        ok:          'var(--ok)',
        warn:        'var(--warn)',
        err:         'var(--err)',
        info:        'var(--info)',
        gold:        'var(--gold)',
        'on-accent': 'var(--on-accent)',
      },
      boxShadow: {
        sm:    'var(--shadow-sm)',
        card:  'var(--shadow-md)',
        lg:    'var(--shadow-lg)',
        fab:   'var(--shadow-fab)',
      },
      animation: {
        'wave-bar': 'waveBar 0.7s ease-in-out infinite alternate',
        'fade-in':  'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        'sheet-in': 'sheetIn 0.25s cubic-bezier(0.2,0.7,0.3,1)',
        'pulse-ring': 'pulseRing 2.4s ease-out infinite',
      },
      keyframes: {
        waveBar: {
          from: { transform: 'scaleY(0.25)' },
          to:   { transform: 'scaleY(1)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
        sheetIn: {
          from: { transform: 'translateY(100%)' },
          to:   { transform: 'translateY(0)' },
        },
        pulseRing: {
          '0%':   { transform: 'scale(0.3)', opacity: '0.8' },
          '100%': { transform: 'scale(1)',   opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
