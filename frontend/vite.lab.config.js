// Standalone build of the Motion Lab (lab.html → dist-lab/). Relative asset
// paths so the output can be hosted at any sub-path. Not part of the app build.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  base: './',
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss, autoprefixer] } },
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist-lab',
    emptyOutDir: true,
    rollupOptions: { input: 'lab.html' },
  },
})
