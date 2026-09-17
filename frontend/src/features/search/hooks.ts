import { useQuery } from '@tanstack/react-query'
import * as searchApi from '@/features/search/api'

export function useSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => searchApi.searchNotes(trimmed),
    enabled: trimmed.length > 0,
  })
}
