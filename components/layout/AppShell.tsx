'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { QueuePanel } from '@/components/player/QueuePanel'
import { LyricsPanel } from '@/components/player/LyricsPanel'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { useAuthStore } from '@/hooks/useAuth'

// 需要登录才能访问的路径前缀
const PROTECTED_PREFIXES = ['/favorites', '/playlists', '/history']

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const initAuth = useAuthStore(s => s.init)
  const authenticated = useAuthStore(s => s.authenticated)
  const loadFavorites = useFavoritesStore(s => s.load)

  // 启动时获取会话状态
  useEffect(() => {
    initAuth()
  }, [initAuth])

  // 登录后才加载收藏；登出后清空
  useEffect(() => {
    if (authenticated === true) {
      loadFavorites()
    }
  }, [authenticated, loadFavorites])

  // 路由守卫：未登录访问受保护页面 → 跳登录
  useEffect(() => {
    if (authenticated === null) return // 加载中，暂不判断
    if (authenticated === false) {
      const isProtected = PROTECTED_PREFIXES.some(p => pathname?.startsWith(p))
      if (isProtected) {
        router.replace('/login')
      }
    }
  }, [authenticated, pathname, router])

  // 登录页：独立全屏，不套播放器外壳（避免 min-h-screen 与 h-screen 布局冲突）
  if (pathname === '/login') {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <PlayerBar />
      <QueuePanel />
      <LyricsPanel />
    </div>
  )
}
