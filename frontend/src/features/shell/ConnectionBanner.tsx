import { TriangleAlert } from '@/design/icons'
import { useCurrentUser } from '@/features/auth/hooks'
import { isConnectionError } from '@/lib/errors'
import { useIsOnline } from '@/lib/useIsOnline'

/** Shown while the browser is offline or the API can't be reached (e.g. mid-deploy).
 * The `me` query keeps polling while it's failing, so this clears on its own. */
export function ConnectionBanner() {
  const online = useIsOnline()
  const me = useCurrentUser()
  const serverDown = me.isError && isConnectionError(me.error)
  if (online && !serverDown) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2.5 border-b border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      <TriangleAlert size={15} strokeWidth={1.5} className="shrink-0" />
      <span className="flex-1">
        {online
          ? "Can't reach the server — retrying. Changes you make now may not be saved."
          : "You're offline. Changes will be saved when the connection is back."}
      </span>
    </div>
  )
}
