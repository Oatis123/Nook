import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as adminApi from '@/features/admin/api'
import type { UserRole } from '@/lib/types'

export function useInvites() {
  return useQuery({ queryKey: ['admin', 'invites'], queryFn: adminApi.listInvites })
}

export function useCreateInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminApi.createInvite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] }),
  })
}

export function useRevokeInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: adminApi.revokeInvite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] }),
  })
}

export function useUsers() {
  return useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.listUsers })
}

function useUserMutation<T>(mutationFn: (arg: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

export const useActivateUser = () => useUserMutation(adminApi.activateUser)
export const useDeactivateUser = () => useUserMutation(adminApi.deactivateUser)
export const useUnlinkTelegram = () => useUserMutation(adminApi.unlinkTelegram)
export const useSetUserRole = () =>
  useUserMutation(({ id, role }: { id: string; role: UserRole }) => adminApi.setUserRole(id, role))

export function useResetPassword() {
  return useMutation({ mutationFn: adminApi.resetPassword })
}
