import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Every merge to main deploys itself, and each deploy used to ship the
        // whole app as one 1.5 MB chunk under a new hash — so a returning
        // reader re-downloaded MapLibre and React, which had not changed,
        // every time our own code did. Split out, the vendor chunks keep
        // their hash (and their place in the browser cache) across releases;
        // only the app chunk is fetched again.
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
    // MapLibre alone is ~1 MB minified and cannot be split further; the
    // warning is about that one known chunk.
    chunkSizeWarningLimit: 1100,
  },
  server: {
    host: true,
    proxy: {
      '/api/v1/stream': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('WS Proxy Error:', err);
          });
        }
      },
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
