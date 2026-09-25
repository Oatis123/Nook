import { useEffect } from 'react'
import { APP_NAME } from '@/lib/env'

/** Sets the browser tab title to "<page> — <app>" (just the app name when empty), so
 * tabs and history entries are distinguishable. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME
  }, [title])
}
