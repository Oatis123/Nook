import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as authApi from '@/features/auth/api'
import { ApiError } from '@/lib/api'

export const meQueryKey = ['me'] as const

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export function useCurrentUser(options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: authApi.getMe,
    // 401 is a real answer (signed out). Anything else — server restarting, network
    // blip — is retried, and while it keeps failing the query polls so the app recovers
    // (and the "can't reach the server" banner clears) on its own. It never throws into
    // the error boundary: a deploy used to replace the whole app with an error page.
    retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 2,
    staleTime: 60_000,
    refetchInterval: (query) => {
      if (query.state.status === 'error' && !isUnauthorized(query.state.error)) return 5000
      return options.poll ? 2000 : false
    },
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { silent: true },
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password),
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.setQueryData(meQueryKey, null)
      queryClient.invalidateQueries()
    },
  })
}

export function useAcceptInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { silent: true },
    mutationFn: authApi.acceptInvite,
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user)
    },
  })
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => authApi.previewInvite(token),
    retry: false,
  })
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: authApi.getSessions,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

export function useRevokeAllSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.revokeAllSessions,
    onSuccess: () => {
      queryClient.setQueryData(meQueryKey, null)
      queryClient.invalidateQueries()
    },
  })
}

export function useApiTokens() {
  return useQuery({
    queryKey: ['api-tokens'],
    queryFn: authApi.getApiTokens,
  })
}

export function useCreateApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.createApiToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.revokeApiToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

export function useCreateTelegramLinkToken() {
  return useMutation({
    meta: { silent: true },
    mutationFn: authApi.createTelegramLinkToken,
  })
}

export function useUnlinkTelegram() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { silent: true },
    mutationFn: authApi.unlinkTelegram,
    onSuccess: (user) => queryClient.setQueryData(meQueryKey, user),
  })
}

export function useCreateTelegramLoginToken() {
  return useMutation({ mutationFn: authApi.createTelegramLoginToken })
}

export function useTelegramLoginStatus(token: string | null) {
  return useQuery({
    queryKey: ['telegram-login-status', token],
    queryFn: () => authApi.checkTelegramLoginStatus(token as string),
    enabled: token !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === undefined ? 2000 : false
    },
    retry: false,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.updateMe,
    onSuccess: (user) => queryClient.setQueryData(meQueryKey, user),
  })
}

export function useChangePassword() {
  return useMutation({
    meta: { silent: true },
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string
      newPassword: string
    }) => authApi.changePassword(currentPassword, newPassword),
  })
}
