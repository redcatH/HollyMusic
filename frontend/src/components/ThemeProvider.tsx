import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { APPEARANCE_STORAGE_KEY, parseAppearance, useAppearanceStore } from '@/lib/store/appearance-store'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useAppearanceStore(s => s.mode)
  const palette = useAppearanceStore(s => s.palette)
  const systemDark = useAppearanceStore(s => s.systemDark)
  const rootRef = useRef<HTMLElement | null>(null)
  const metaRef = useRef<HTMLMetaElement | null>(null)
  const dark = mode === 'dark' || (mode === 'system' && systemDark)

  useLayoutEffect(() => {
    // html 位于 React 挂载点之外；集中在此通过 ref 同步全局主题。
    rootRef.current ??= document.documentElement
    metaRef.current ??= document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const root = rootRef.current
    root.dataset.theme = dark ? 'dark' : 'light'
    root.dataset.palette = palette
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
    if (metaRef.current) metaRef.current.content = getComputedStyle(root).getPropertyValue('--browser-chrome').trim()
  }, [dark, palette])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => useAppearanceStore.setState({ systemDark: media.matches })
    const onStorage = (event: StorageEvent) => {
      if ((event.key === APPEARANCE_STORAGE_KEY || event.key === null) && event.storageArea === window.localStorage) {
        useAppearanceStore.setState(parseAppearance(event.newValue))
      }
    }
    onSystemChange()
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return children
}
