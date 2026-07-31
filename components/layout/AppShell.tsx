'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Sidebar, MobileSidebar } from './Sidebar'
import { ServiceWorkerRegister } from './ServiceWorkerRegister'
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
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  // 路由切换 → 关闭抽屉
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // 抽屉打开时：ESC 关闭 + 锁定 body 滚动
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  // 登录页：独立全屏，不套播放器外壳（避免 min-h-screen 与 h-screen 布局冲突）
  if (pathname === '/login') {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ServiceWorkerRegister />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <PlayerBar />
      {/* 小屏汉堡按钮（<768px 可见，固定左上角） */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="fixed left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-foreground shadow-lg backdrop-blur-sm transition hover:bg-card md:hidden"
        aria-label="打开菜单"
      >
        <Menu className="h-5 w-5" />
      </button>
      <MobileSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <QueuePanel />
      <LyricsPanel />
    </div>
  )
}
