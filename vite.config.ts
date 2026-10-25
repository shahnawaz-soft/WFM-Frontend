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
      // About one worker per physical core. The default (all logical cores but one) runs as many
      // jsdom workers as hardware threads; they compete for cores and memory, and single tests
      // run ~2.5× slower for no gain in total time, timing out on a busy machine.
      maxWorkers: '50%',
      // A guard against hangs. The longest whole-app flows (~10 steps) take ~1 s on an idle
      // machine but 4–5 s when the CPU is saturated, right at the 5 s default.
      testTimeout: 15_000,
      coverage: { include: ['src/**'], exclude: ['src/test/**', 'src/main.tsx'] },
    },
  }
})
