/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/healthz': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    // T13 carry #3（Task 1 minor ②）：固化 jsdom 文档 URL（smoke.test 的 location.href 断言因此不依赖默认值）。
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['src/test-setup.ts'],
  },
})
