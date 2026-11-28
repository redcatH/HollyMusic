import { useEffect, useState } from 'react'
import { getPlatformList } from '@/lib/api/platforms'
import { BUILTIN_PLATFORMS, rememberPlatformNames } from '@/lib/platform-plugins'

export function usePlatforms() {
  const [items, setItems] = useState(BUILTIN_PLATFORMS)
  useEffect(() => {
    let controller: AbortController | undefined
    const refresh = () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      void getPlatformList(signal).then(result => {
        if (!signal.aborted) { rememberPlatformNames(result); setItems(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result) }
      }).catch(() => {})
    }
    refresh()
    window.addEventListener('platform-plugins-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      controller?.abort()
      window.removeEventListener('platform-plugins-changed', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return items
}
