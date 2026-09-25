import { useCurrentUser } from '@/features/auth/hooks'
import { todayIn } from '@/lib/dates'

/** Today (`YYYY-MM-DD`) in the signed-in user's profile timezone — the same "today" the
 * backend uses for the Today view and overdue checks. */
export function useToday(): string {
  const { data: user } = useCurrentUser()
  return todayIn(user?.timezone)
}
