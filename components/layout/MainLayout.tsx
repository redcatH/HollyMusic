'use client'

import { usePlayerStore } from '@/lib/store'
import { useEffect } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomPlayer } from './BottomPlayer'

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { isDarkMode } = usePlayerStore()

  // 初始化深色模式
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      usePlayerStore.setState({ isDarkMode: e.matches })
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div
        className={`min-h-screen ${
          isDarkMode
            ? 'bg-black text-white'
            : 'bg-white text-black'
        }`}
      >
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 lg:ml-64 pb-24">
            {children}
          </main>
        </div>
        <BottomPlayer />
      </div>
    </div>
  )
}
