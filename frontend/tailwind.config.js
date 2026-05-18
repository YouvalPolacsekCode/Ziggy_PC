/** @type {import('tailwindcss').Config} */
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
        // Ziggy warm-neutral palette — maps to CSS custom props
        // Light
        paper:   '#F5F2ED',
        'paper-2': '#EDE9E3',
        surface: '#FFFFFF',
        'surface-2': '#F2EDE7',
        ink:     '#2E2518',
        'ink-2': '#4D3D2C',
        'ink-mute': '#7A6655',
        'ink-faint': '#9E8C7E',
        line:    '#DDD8D0',
        'line-2': '#CEC8BE',
        accent:  '#C96442',
        'accent-2': '#F7E8E2',
        ok:      '#3D8A5F',
        warn:    '#A07030',
        info:    '#3D6A9E',
      },
      boxShadow: {
        card:  '0 1px 0 rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.10)',
        'card-dark': '0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -12px rgba(0,0,0,0.50)',
        'card-hover': '0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)',
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
