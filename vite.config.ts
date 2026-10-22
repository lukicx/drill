import { readFileSync, writeFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Stamps the service worker with the build time, so browsers see a changed file after each deploy
// and refresh their offline copy of the app and question sets.
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const file = new URL('./dist/sw.js', import.meta.url)
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', String(Date.now())))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  // GitHub Pages serves the app at https://lukicx.github.io/drill/
  base: '/drill/',
  // KaTeX (formula rendering) makes the single bundle ~0.5 MB; it is cached offline, so that is fine.
  build: { chunkSizeWarningLimit: 600 },
})
