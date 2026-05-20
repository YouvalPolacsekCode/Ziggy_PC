import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Disable VitePWA's own SW injection — we manage our own sw.js which
      // handles push notifications. VitePWA's auto-generated SW would conflict.
      injectRegister: false,
      selfDestroying: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Ziggy',
        short_name: 'Ziggy',
        description: 'Your AI smart home assistant',
        // theme/background match the LIGHT palette --bg (#F5F2ED). The dark
        // status-bar color is set per-color-scheme in index.html via
        // <meta name="theme-color"> media queries, which override this for
        // dark-mode users. Manifest is the install-time fallback.
        theme_color: '#F5F2ED',
        background_color: '#F5F2ED',
        display: 'standalone',
        // Chain: standalone everywhere → minimal-ui on legacy Android Chrome
        // (which sometimes refuses standalone). window-controls-overlay is
        // desktop-PWA only; it has no effect on phones and is harmless here.
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities', 'lifestyle'],
        icons: [
          // Both `any` (regular launch icon) and `maskable` (Android adaptive
          // icon framing) need explicit entries. A single combined "any maskable"
          // works but Android sometimes still crops it; splitting is safest.
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg',     sizes: 'any',      type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Auto-claim clients so the new SW activates immediately on install
        // (no need to close all tabs), and skip the waiting phase.
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  resolve: {
    // Force a single React instance across all packages.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // react-konva is CommonJS and uses require('react'). Without explicit inclusion
    // here, esbuild pre-bundles it in isolation and creates a second React copy,
    // causing "Invalid hook call" errors at app startup.
    include: ['react', 'react-dom', 'konva', 'react-konva'],
  },
  server: {
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api':      'http://localhost:8001',
      '/presence': 'http://localhost:8001',
      '/ws':       { target: 'ws://localhost:8001', ws: true },
    },
  },
})
