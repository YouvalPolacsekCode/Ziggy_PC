/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Neutral smart home palette
        zinc: {
          50: '#fafafa',
          100: '#f4f4f5',
          150: '#efefef',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          750: '#333338',
          800: '#27272a',
          850: '#1f1f22',
          900: '#18181b',
          950: '#09090b',
        },
        // AI section glows
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        // Orb accent
        indigo: {
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
        'card-dark': '0 1px 3px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.1), 0 8px 32px rgba(0,0,0,0.08)',
        'orb': '0 0 60px rgba(124,58,237,0.5), 0 0 120px rgba(99,102,241,0.3), 0 0 200px rgba(6,182,212,0.15)',
        'orb-pulse': '0 0 80px rgba(124,58,237,0.7), 0 0 160px rgba(99,102,241,0.5)',
        'toggle-on': '0 0 0 2px rgba(124,58,237,0.3)',
      },
      backgroundImage: {
        'orb-gradient': 'radial-gradient(circle at 35% 35%, #c4b5fd, #8b5cf6 40%, #4f46e5 65%, #06b6d4 100%)',
        'orb-shine': 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.6) 0%, transparent 50%)',
        'ai-bg': 'radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(6,182,212,0.08) 0%, transparent 50%)',
      },
      animation: {
        'orb-idle': 'orbIdle 6s ease-in-out infinite',
        'orb-pulse': 'orbPulse 1.5s ease-in-out infinite',
        'orb-think': 'orbThink 1s linear infinite',
        'ring-expand': 'ringExpand 2s ease-out infinite',
        'ring-expand-2': 'ringExpand 2s ease-out 0.6s infinite',
        'ring-expand-3': 'ringExpand 2s ease-out 1.2s infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        'shimmer': 'shimmer 3s ease-in-out infinite',
      },
      keyframes: {
        orbIdle: {
          '0%, 100%': { transform: 'scale(1) translateY(0px)', filter: 'brightness(1)' },
          '50%': { transform: 'scale(1.03) translateY(-4px)', filter: 'brightness(1.1)' },
        },
        orbPulse: {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 60px rgba(124,58,237,0.5)' },
          '50%': { transform: 'scale(1.08)', boxShadow: '0 0 100px rgba(124,58,237,0.8)' },
        },
        orbThink: {
          '0%': { filter: 'hue-rotate(0deg)' },
          '100%': { filter: 'hue-rotate(360deg)' },
        },
        ringExpand: {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
}
