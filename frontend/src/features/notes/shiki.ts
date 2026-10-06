import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

// A curated subset, not shiki's full ~200-grammar catalog — each is its own dynamic
// import (a literal string, so bundlers can statically split it into its own chunk),
// fetched only once a note actually has a code block in that language.
const langLoaders = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
}
type LangFile = keyof typeof langLoaders

/** Every language name and alias a code block can use, mapped to the grammar file that
 * brings it. Some come in only as another grammar's dependency (xml with php; lua,
 * graphql and haml with ruby; glsl and regexp with cpp) — they were highlighted back when
 * every file was loaded up front, so they still are. */
const LANGUAGE_FILE: Record<string, LangFile> = {
  javascript: 'javascript',
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'python',
  py: 'python',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  markdown: 'markdown',
  md: 'markdown',
  html: 'html',
  css: 'css',
  sql: 'sql',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  'cpp-macro': 'cpp',
  glsl: 'cpp',
  regexp: 'cpp',
  regex: 'cpp',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  ruby: 'ruby',
  rb: 'ruby',
  haml: 'ruby',
  lua: 'ruby',
  graphql: 'ruby',
  gql: 'ruby',
  php: 'php',
  xml: 'php',
  toml: 'toml',
  docker: 'docker',
  dockerfile: 'docker',
  diff: 'diff',
}

/** Grammars that highlight code nested in them (a fence inside a markdown block) with
 * whatever languages happen to be loaded: they get all of them, as before. */
const EMBEDS_ANY_LANGUAGE = new Set(['markdown', 'md', 'haml'])

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedFiles = new Set<LangFile>()

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  }).catch((error: unknown) => {
    // Don't cache a failed load (e.g. a network blip mid-deploy) forever — the next
    // caller retries.
    highlighterPromise = null
    throw error
  })
  return highlighterPromise
}

/** Loads the grammars the given code-block languages need. A language that isn't
 * covered stays plain text, as it always did; a grammar that fails to load is tried
 * again on the next call. */
export async function loadLanguages(
  highlighter: HighlighterCore,
  languages: Iterable<string>,
): Promise<void> {
  const files = new Set<LangFile>()
  for (const language of languages) {
    if (EMBEDS_ANY_LANGUAGE.has(language)) {
      for (const file of Object.keys(langLoaders) as LangFile[]) files.add(file)
    } else if (Object.hasOwn(LANGUAGE_FILE, language)) {
      files.add(LANGUAGE_FILE[language])
    }
  }
  const missing = [...files].filter((file) => !loadedFiles.has(file))
  if (missing.length === 0) return
  try {
    await highlighter.loadLanguage(...missing.map((file) => langLoaders[file]()))
    for (const file of missing) loadedFiles.add(file)
  } catch {
    // Highlighted as plain text this time.
  }
}
