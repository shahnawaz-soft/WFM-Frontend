/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // In development the SPA calls same-origin /api and /health; Vite proxies them to Django,
  // so no CORS setup is needed locally.
  const apiTarget = env.VITE_DEV_API_PROXY ?? 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      restoreMocks: true,
      coverage: { include: ['src/**'], exclude: ['src/test/**', 'src/main.tsx'] },
    },
  }
})
