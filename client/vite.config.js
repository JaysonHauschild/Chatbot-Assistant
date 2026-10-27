import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import docsSite from '../docs/site/vite-plugin.mjs'
import { fileURLToPath } from 'node:url'

const embedTestPage = fileURLToPath(new URL('./embed-test/index.html', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  base: '/chatbot/',
  plugins: [react(), docsSite()],
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        embedTest: embedTestPage,
      },
    },
  },
  server: {
    // Wait for source writes to finish before invalidating transformed modules.
    // Otherwise an in-place save can leave an empty module in the dev cache.
    watch: {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 25 },
    },
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["163.245.192.111", "apps.oksbdc.org"],
    hmr: {
      protocol: "wss",
      host: "apps.oksbdc.org",
      clientPort: 443,
    },
    headers: {
      "ngrok-skip-browser-warning": "true",
    },
  },
})
