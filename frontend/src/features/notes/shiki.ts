import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

// A curated subset, not shiki's full ~200-grammar catalog — each is its own dynamic
// import (a literal string, so bundlers can statically split it into its own chunk),
// keeping this out of the main bundle and off unrelated pages.
const langLoaders = [
  () => import('shiki/langs/javascript.mjs'),
  () => import('shiki/langs/typescript.mjs'),
  () => import('shiki/langs/jsx.mjs'),
  () => import('shiki/langs/tsx.mjs'),
  () => import('shiki/langs/python.mjs'),
  () => import('shiki/langs/bash.mjs'),
  () => import('shiki/langs/json.mjs'),
  () => import('shiki/langs/yaml.mjs'),
  () => import('shiki/langs/markdown.mjs'),
  () => import('shiki/langs/html.mjs'),
  () => import('shiki/langs/css.mjs'),
  () => import('shiki/langs/sql.mjs'),
  () => import('shiki/langs/go.mjs'),
  () => import('shiki/langs/rust.mjs'),
  () => import('shiki/langs/java.mjs'),
  () => import('shiki/langs/c.mjs'),
  () => import('shiki/langs/cpp.mjs'),
  () => import('shiki/langs/csharp.mjs'),
  () => import('shiki/langs/ruby.mjs'),
  () => import('shiki/langs/php.mjs'),
  () => import('shiki/langs/toml.mjs'),
  () => import('shiki/langs/docker.mjs'),
  () => import('shiki/langs/diff.mjs'),
]

let highlighterPromise: Promise<HighlighterCore> | null = null

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: langLoaders.map((load) => load()),
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })
  return highlighterPromise
}
