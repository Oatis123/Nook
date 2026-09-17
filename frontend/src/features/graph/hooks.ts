import { useQuery } from '@tanstack/react-query'
import * as graphApi from '@/features/graph/api'
import type { GraphParams } from '@/features/graph/api'

export function useGraph(params: GraphParams) {
  return useQuery({
    queryKey: ['graph', params],
    queryFn: () => graphApi.getGraph(params),
  })
}
