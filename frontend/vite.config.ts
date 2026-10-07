/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const rootDir = import.meta.dirname

/** @fontsource's @font-face rules list a .woff after each .woff2, and KaTeX's a .woff and a
 * .ttf — fallbacks for browsers without WOFF2, and every browser this app supports has it.
 * Dropping them shortens every rule in the render-blocking stylesheet (and the fallback
 * files are no longer emitted). */
function woff2Only(): Plugin {
  return {
    name: 'nook:woff2-only',
    enforce: 'pre',
    // After Tailwind, which inlines the stylesheet's @imports (the @fontsource files among
    // them) itself; before Vite resolves the url()s into emitted assets.
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id) || !code.includes('@font-face')) return null
      return code.replace(
        /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\(['"]?(?:woff|truetype)['"]?\)/g,
        '',
      )
    },
  }
}

/** micromark decodes HTML entities (&amp;) with decode-named-character-reference, whose
 * browser build does it through a DOM element — which the note preview's Web Worker
 * doesn't have, so the worker died on load and the preview silently fell back to the
 * main thread. Its plain build decodes the same entities from a table. Applied
 * everywhere, so the dev server's worker gets it too. */
function domFreeEntityDecoding(): Plugin {
  return {
    name: 'nook:dom-free-entity-decoding',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== 'decode-named-character-reference') return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      // The dev server's ids carry a version query (index.dom.js?v=…).
      const id = resolved?.id.replace(/index\.dom\.js(?=$|\?)/, 'index.js')
      return resolved && { ...resolved, id: id ?? resolved.id }
    },
  }
}

// index.html uses %APP_NAME%; without a value (a local build with no .env) Vite would
// leave the placeholder in the page title verbatim.
process.env.APP_NAME ||= 'Nook'

// https://vite.dev/config/
export default defineConfig({
  plugins: [domFreeEntityDecoding(), react(), tailwindcss(), woff2Only()],
  build: {
    // Vite inlines files under 4 KB as base64 — for fonts that meant ~90 KB of barely
    // compressible data in the render-blocking CSS, for script subsets (Greek,
    // Vietnamese, math…) that most pages never use. As files, each is fetched only when
    // the page has a character from its unicode-range.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  // The note preview's worker loads grammars on demand (dynamic imports), which needs ES
  // module output — the default IIFE can't be split into chunks.
  worker: { format: 'es', plugins: () => [domFreeEntityDecoding()] },
  // The dev server pre-bundles dependencies without the plugins above; left out of that
  // bundle, the package is resolved through domFreeEntityDecoding like any other import.
  optimizeDeps: { exclude: ['decode-named-character-reference'] },
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
