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

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const authenticated = useAuthStore(s => s.authenticated)
  const username = useAuthStore(s => s.username)
  const logout = useAuthStore(s => s.logout)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNav = (href: string, isProtected: boolean) => {
    if (isProtected && authenticated === false) {
      router.push('/login')
      return
    }
    router.push(href)
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout()
    router.push('/')
  }

  const goAdmin = () => {
    setMenuOpen(false)
    router.push('/admin/users')
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-2 text-sidebar-foreground md:flex">
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
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <LogIn className="h-5 w-5" />
            登录
          </Link>
        )}
      </div>
    </aside>
  )
}
