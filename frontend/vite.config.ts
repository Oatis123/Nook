/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Single source of truth for APP_NAME is the repo-root .env (see TECH_SPEC.md §0 / .env.example).
  envDir: path.resolve(rootDir, '..'),
  envPrefix: ['VITE_', 'APP_NAME'],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Scoped to src/ so vitest's default *.spec.ts glob doesn't also try (and fail) to
    // run the Playwright specs under e2e/ — a different test runner, own config file.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
