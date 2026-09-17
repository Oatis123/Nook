import { apiFetch } from '@/lib/api'
import type { SearchResult } from '@/lib/types'

export const searchNotes = (query: string) =>
  apiFetch<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`)
