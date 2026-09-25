import { useSyncExternalStore } from 'react'

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine)
}
