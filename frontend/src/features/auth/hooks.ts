import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as authApi from '@/features/auth/api'
import { ApiError } from '@/lib/api'

export const meQueryKey = ['me'] as const

export function useCurrentUser() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: authApi.getMe,
    retry: false,
    staleTime: 60_000,
    throwOnError: (error) => !(error instanceof ApiError && error.status === 401),
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
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

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.updateMe,
    onSuccess: (user) => queryClient.setQueryData(meQueryKey, user),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string
      newPassword: string
    }) => authApi.changePassword(currentPassword, newPassword),
  })
}
