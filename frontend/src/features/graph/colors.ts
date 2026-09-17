/** Deterministic string → HSL color, so the same folder/tag always gets the same node
 * color across renders and sessions without maintaining a fixed palette/lookup table.
 * Canvas fillStyle can't resolve CSS custom properties (var(...)) the way DOM styles do,
 * so this returns a plain hsl() string rather than reaching for a design token. */
export function colorForKey(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 55%)`
}
