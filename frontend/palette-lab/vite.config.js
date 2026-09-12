// Ziggy Palette Lab — its own Vite app.
//
// Deliberately NOT a route inside the real frontend. The lab must not be able
// to affect production by accident, so it has its own root, its own index.html
// and its own entry, and it imports NOTHING from ../src. The only thing it
// shares is node_modules, which is why it lives under frontend/ rather than at
// the repo root — Vite resolves React and friends by walking up from the root
// directory, so a sibling of frontend/ would need its own install.
//
// Run it:
//   cd frontend && npx vite --config palette-lab/vite.config.js
//
// It listens on 4310 so it can never collide with the app's dev servers.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 4310,
    strictPort: true,
    host: '127.0.0.1',
    fs: {
      // Nothing outside this folder is servable. A stray `../src/...` import
      // fails loudly instead of quietly coupling the lab to production.
      allow: [__dirname],
    },
  },
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
