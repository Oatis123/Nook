export const MAX_TAGS = 20
// The same shape as a note's #tag (backend app/schemas/task.py), without the `#`.
const TAG_RE = /^\p{L}[\p{L}\p{N}_-]*(?:\/\p{L}[\p{L}\p{N}_-]*)*$/u

/** "#Home/repairs " -> "Home/repairs"; null when it isn't a valid tag. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#/, '')
  return TAG_RE.test(tag) && tag.length <= 255 ? tag : null
}
