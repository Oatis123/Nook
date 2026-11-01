/** The five category inks (oatis-style), in the style's order. */
export const INKS = ['bi', 'fn', 'type', 'prop', 'kw'] as const
export type Ink = (typeof INKS)[number]

/** Deterministic string → one of the five category inks, so the same folder/tag always
 * gets the same node color across renders and sessions. Five, not a hue per key: the
 * style allows at most five inks on a screen, so folders share them. */
export function inkForKey(key: string): Ink {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i)
    hash |= 0
  }
  return INKS[Math.abs(hash) % INKS.length]
}
