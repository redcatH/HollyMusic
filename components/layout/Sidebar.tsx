'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Home, Search, Heart, ListMusic, History, Music2, LogIn, LogOut, User, ChevronUp, Users } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'

const nav = [
  { href: '/', label: '首页', icon: Home, protected: false },
  { href: '/search', label: '搜索', icon: Search, protected: false },
  { href: '/favorites', label: '收藏', icon: Heart, protected: true },
  { href: '/playlists', label: '歌单', icon: ListMusic, protected: true },
  { href: '/history', label: '历史', icon: History, protected: true },
]

interface ContentProps {
  /** 导航/登出动作后回调（小屏抽屉用于关闭） */
  onNavigate?: () => void
}

/**
 * Sidebar 共享内容：logo + 主导航 + 底部用户区（含用户管理下拉）。
 * 由 Sidebar（大屏常驻）与 MobileSidebar（小屏抽屉）复用，避免逻辑重复。
 */
function SidebarContent({ onNavigate }: ContentProps) {
  const pathname = usePathname()
  const router = useRouter()
  const authenticated = useAuthStore(s => s.authenticated)
  const username = useAuthStore(s => s.username)
  const logout = useAuthStore(s => s.logout)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNav = (href: string, isProtected: boolean) => {
    onNavigate?.()
    if (isProtected && authenticated === false) {
      router.push('/login')
      return
    }
    router.push(href)
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    onNavigate?.()
    await logout()
    router.push('/')
  }

  const goAdmin = () => {
    setMenuOpen(false)
    onNavigate?.()
    router.push('/admin/users')
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-4">
        <Music2 className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">Holly Music</span>
      </div>
      <nav className="flex flex-col gap-1">
        {nav.map(item => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <button
              key={item.href}
              onClick={() => handleNav(item.href, item.protected)}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="relative mt-auto border-t border-border p-2">
        {authenticated ? (
          <>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
              aria-expanded={menuOpen}
            >
              <span className="flex min-w-0 items-center gap-2">
                <User className="h-4 w-4 shrink-0" />
                <span className="truncate">{username}</span>
              </span>
              <ChevronUp className={`h-4 w-4 shrink-0 transition-transform ${menuOpen ? '' : 'rotate-180'}`} />
            </button>
            {menuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-border bg-popover p-1 shadow-lg">
                {username === 'admin' && (
                  <button
                    onClick={goAdmin}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Users className="h-5 w-5" />
                    用户管理
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="h-5 w-5" />
                  登出
                </button>
              </div>
            )}
          </>
        ) : (
          <Link
            href="/login"
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <LogIn className="h-5 w-5" />
            登录
          </Link>
        )}
      </div>
    </>
  )
}

/** 大屏常驻侧边栏（≥768px） */
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-2 text-sidebar-foreground md:flex">
      <SidebarContent />
    </aside>
  )
}

/**
 * 小屏导航抽屉（<768px）
 * 从左侧滑入，带半透明遮罩；点遮罩或导航动作（onNavigate）即关闭。
 */
export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className="md:hidden">
      {/* 遮罩 */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      {/* 面板 */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-sidebar p-2 text-sidebar-foreground shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  )
}
