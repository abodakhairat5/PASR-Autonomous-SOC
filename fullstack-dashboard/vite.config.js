import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: 5174,
    // Allow the Cloudflare Tunnel quick-tunnel hostname (and local hostnames)
    // so the dev server accepts requests forwarded with a non-local Host header.
    // ".trycloudflare.com" matches any subdomain Cloudflare assigns to a quick tunnel.
    allowedHosts: ['.trycloudflare.com', 'localhost', '127.0.0.1'],

    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // The PASR autonomous pipeline (8 sequential LLM agent calls) can
        // take several minutes. Allow long-running requests through the proxy.
        timeout: 6 * 60 * 1000,
        proxyTimeout: 6 * 60 * 1000,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[vite proxy] error:', err.message)
          })
        },
      },
    },
  },
})