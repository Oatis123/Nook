import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ConfirmHost } from '@/design/components/ConfirmHost'
import { Toaster } from '@/design/components/Toaster'
import { TooltipProvider } from '@/design/components/Tooltip'
import { router } from '@/app/router'
import { meQueryKey } from '@/features/auth/hooks'
import { ApiError, setSessionExpiredHandler } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The call site shows this mutation's errors itself — no global toast. */
      silent?: boolean
      /** Statuses the call site handles itself (e.g. 409 → a confirm dialog). */
      handledStatuses?: number[]
    }
  }
}

/** Telegram was unlinked (e.g. in another tab): refetch the user so the app shows the
 * onboarding gate instead of failing request by request. */
function handleNotLinked(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 403 && error.code === 'telegram_not_linked') {
    queryClient.invalidateQueries({ queryKey: meQueryKey })
    return true
  }
  return false
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleNotLinked }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
  // Every mutation that fails without its own error UI used to fail silently; this
  // reports it once, globally.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.options.meta
      if (handleNotLinked(error) || meta?.silent) return
      if (error instanceof ApiError) {
        if (error.status === 401) return // session expired: the app is heading to /login
        if (meta?.handledStatuses?.includes(error.status)) return
      }
      toast.error(errorMessage(error))
    },
  }),
})

setSessionExpiredHandler(() => queryClient.setQueryData(meQueryKey, null))

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
        <ConfirmHost />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
