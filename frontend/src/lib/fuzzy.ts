/** Subsequence fuzzy match: every query character must appear in `text`, in order, allowing
 * gaps. Returns null on no match, else a score where higher is better — rewards consecutive
 * runs and an early match start, the same signal VS Code/Sublime-style switchers use, without
 * pulling in a dependency for what quick-switcher-scale note lists (dozens to low thousands)
 * need. */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  let qi = 0
  let score = 0
  let consecutive = 0
  let firstMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatchIndex === -1) firstMatchIndex = ti
      consecutive += 1
      score += consecutive * 2
      qi += 1
    } else {
      consecutive = 0
    }
  }

  if (qi < q.length) return null

  score -= firstMatchIndex * 0.5
  score -= (t.length - q.length) * 0.05
  return score
}

export function fuzzyFilter<T>(query: string, items: T[], getText: (item: T) => string): T[] {
  if (query.trim().length === 0) return items
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}
