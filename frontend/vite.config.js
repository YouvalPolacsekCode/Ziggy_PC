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
      // We ship our own SW from public/sw.js — push notifications only, no
      // precaching. The previously-generated workbox SW precached the hashed
      // JS bundle and served stale index.html that pointed at long-deleted
      // asset hashes after every rebuild, breaking mobile clients with a
      // bare-HTML page. `strategies: 'injectManifest'` makes VitePWA leave
      // our public/sw.js alone (we ignore the injection point) while still
      // emitting the webmanifest + install metadata.
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      injectRegister: false,
      injectManifest: {
        // We don't reference self.__WB_MANIFEST in our SW, so VitePWA
        // would warn about a missing injection point — disable that check.
        injectionPoint: undefined,
      },
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
      // No `workbox` block — injectManifest mode reads the SW source from
      // public/sw.js as-is.
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
  build: {
    // Modern target — every browser that runs Ziggy supports ES2020 natively
    // (mobile PWA users are evergreen, desktop dev is Chrome/Firefox/Safari
    // current). Skipping the legacy-friendly transpile saves ~10–15 KB and
    // lets Vite keep async/await + optional chaining as-is.
    target: 'es2020',
    // No sourcemaps in prod — saves ~3-5 MB of asset disk + faster builds.
    // Re-enable temporarily if production debugging needs them.
    sourcemap: false,
    // Smaller chunk size warnings to keep the bundle honest.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual vendor chunks: keeps third-party code in stable file hashes
        // so a Ziggy code change doesn't bust the user's cached vendor JS.
        // konva/react-konva are HEAVY (~250 KB minified) and only used by
        // Rooms' HomeMapCanvas — keep them in their own chunk that lazy-loads
        // alongside the Rooms page.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor':    ['framer-motion', 'lucide-react', 'clsx', 'tailwind-merge'],
          'radix-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-slider',
            '@radix-ui/react-switch',
          ],
          'konva-vendor': ['konva', 'react-konva'],
          'state-vendor': ['zustand'],
        },
      },
    },
  },
})
