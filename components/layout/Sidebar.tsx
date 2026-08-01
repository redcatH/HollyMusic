'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLinkStatus } from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Home, Search, Heart, ListMusic, History, Music2, LogIn, LogOut, User, ChevronUp, Settings, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'
import { useNavStore } from '@/lib/store/nav-store'

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
 * 导航项：用 next/link 的 <Link> 替代 router.push，启用 prefetch + useLinkStatus。
 *
 * useLinkStatus 必须是 <Link> 的后代组件才能工作，返回 pending 状态：
 * 点击链接 → RSC fetch 发起（pending=true）→ RSC 返回 commit（pending=false）。
 * 这让用户立即看到"导航已触发"的反馈，而非等 RSC 返回才响应。
 */
function NavLink({
  href,
  label,
  icon: Icon,
  active,
  isProtected,
  authenticated,
  onNavigate,
}: {
  href: string
  label: string
  icon: typeof Home
  active: boolean
  isProtected: boolean
  authenticated: boolean | null
  onNavigate?: () => void
}) {
  const { pending } = useLinkStatus()
  const router = useRouter()
  const setPendingPath = useNavStore(s => s.setPendingPath)

  // 受保护路由 + 未登录 → 跳登录页（拦截 Link 的默认导航）
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onNavigate?.()
    if (isProtected && authenticated === false) {
      e.preventDefault()
      router.push('/login')
      return
    }
    // 立即设置 pendingPath → AppShell main 区域显示 loading 骨架（SPA 式切换）
    setPendingPath(href)
    // 其余情况让 <Link> 正常工作（含 prefetch + 客户端导航）
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
      }`}
    >
      {pending ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : (
        <Icon className="h-5 w-5" />
      )}
      {label}
    </Link>
  )
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
  const setPendingPath = useNavStore(s => s.setPendingPath)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    setMenuOpen(false)
    onNavigate?.()
    setPendingPath('/')
    await logout()
    router.push('/')
  }

  const goAdmin = () => {
    setMenuOpen(false)
    onNavigate?.()
    setPendingPath('/admin')
    router.push('/admin')
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
          return (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={active}
              isProtected={item.protected}
              authenticated={authenticated}
              onNavigate={onNavigate}
            />
          )
        })}
      </nav>

      <div className="relative mt-auto border-t border-border p-2">
        {authenticated === true ? (
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
                    <Settings className="h-5 w-5" />
                    系统管理
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
        ) : authenticated === false ? (
          <Link
            href="/login"
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <LogIn className="h-5 w-5" />
            登录
          </Link>
        ) : null}
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
