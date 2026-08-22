import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Search, Heart, ListMusic, History, Music2, LogIn, LogOut, User, ChevronUp, Settings, KeyRound, Shuffle } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'

const nav = [
  { href: '/', label: '首页', icon: Home, protected: false },
  { href: '/recommend', label: '推荐', icon: Shuffle, protected: false },
  { href: '/search', label: '搜索', icon: Search, protected: true },
  { href: '/favorites', label: '收藏', icon: Heart, protected: true },
  { href: '/playlists', label: '歌单', icon: ListMusic, protected: true },
  { href: '/history', label: '历史', icon: History, protected: true },
]

interface ContentProps {
  /** 导航/登出动作后回调（小屏抽屉用于关闭） */
  onNavigate?: () => void
}

/**
 * 导航项：react-router 的 <Link>，navigate() 同步更新 URL + 组件立即切换。
 * 不再需要 useLinkStatus / pendingPath / activePath——SPA 导航零等待。
 */
function NavLink({
  href,
  label,
  icon: Icon,
  isProtected,
  authenticated,
  onNavigate,
}: {
  href: string
  label: string
  icon: typeof Home
  isProtected: boolean
  authenticated: boolean | null
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = pathname === href

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onNavigate?.()
    if (isProtected && authenticated === false) {
      e.preventDefault()
      navigate('/login')
      return
    }
    // react-router 的 <Link> 正常工作，导航是同步的，组件立即切换
  }

  return (
    <Link
      to={href}
      onClick={handleClick}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  )
}

/**
 * Sidebar 共享内容：logo + 主导航 + 底部用户区（含用户管理下拉）。
 */
function SidebarContent({ onNavigate }: ContentProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const authenticated = useAuthStore(s => s.authenticated)
  const username = useAuthStore(s => s.username)
  const logout = useAuthStore(s => s.logout)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    setMenuOpen(false)
    onNavigate?.()
    await logout()
    navigate('/')
  }

  const goAdmin = () => {
    setMenuOpen(false)
    onNavigate?.()
    navigate('/admin')
  }

  const goChangePassword = () => {
    setMenuOpen(false)
    onNavigate?.()
    navigate('/change-password')
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-4">
        <Music2 className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">Holly Music</span>
      </div>
      <nav className="flex flex-col gap-1">
        {nav.map(item => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            isProtected={item.protected}
            authenticated={authenticated}
            onNavigate={onNavigate}
          />
        ))}
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
                  onClick={goChangePassword}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <KeyRound className="h-5 w-5" />
                  修改密码
                </button>
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
            to="/login"
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
 */
export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className="md:hidden">
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
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
