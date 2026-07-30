'use client'

import { Home, Music, Heart, ListMusic, Settings, History } from 'lucide-react'
import Link from 'next/link'
import { usePlayerStore } from '@/lib/store'
import { usePathname } from 'next/navigation'
import { usePlayHistory } from '@/hooks/usePlayHistory'

type MenuItem = {
  id: string
  label: string
  icon: React.ReactNode
  badge?: number
  href?: string
}

export function Sidebar() {
  const { isDarkMode, sidebarOpen } = usePlayerStore()
  const pathname = usePathname()
  const { count } = usePlayHistory()

  const menuItems: MenuItem[] = [
    { id: 'home', label: '首页', icon: <Home className="h-5 w-5" />, href: '/' },
    { id: 'search', label: '发现音乐', icon: <Music className="h-5 w-5" />, href: '/' },
    { id: 'favorites', label: '我的收藏', icon: <Heart className="h-5 w-5" />, href: '/' },
    { id: 'playlists', label: '播放列表', icon: <ListMusic className="h-5 w-5" />, href: '/' },
    { id: 'history', label: '历史播放', icon: <History className="h-5 w-5" />, href: '/history', badge: count || undefined },
  ]

  const getActiveMenuId = () => {
    if (pathname === '/history') return 'history'
    return 'home'
  }

  const activeMenu = getActiveMenuId()

  return (
    <>
      {/* 移动端背景遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => usePlayerStore.setState({ sidebarOpen: false })}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-16 bottom-24 z-40 w-64 overflow-y-auto transition-transform lg:fixed lg:bottom-0 lg:w-64 ${
          isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'
        } border-r ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <nav className="space-y-1 p-4">
          {menuItems.map((item) => (
            <Link
              key={item.id}
              href={item.href || '#'}
              className={`w-full flex items-center justify-between gap-3 rounded-lg px-4 py-3 transition-colors ${
                activeMenu === item.id
                  ? isDarkMode
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-100 text-purple-900'
                  : isDarkMode
                  ? 'text-gray-300 hover:bg-gray-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-3">
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold bg-red-500 text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* 分割线 */}
        <div
          className={`mx-4 my-4 h-px ${
            isDarkMode ? 'bg-gray-800' : 'bg-gray-200'
          }`}
        />

        {/* 设置 */}
        <div className="p-4">
          <button
            className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
              isDarkMode
                ? 'text-gray-300 hover:bg-gray-800'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Settings className="h-5 w-5" />
            <span className="text-sm font-medium">设置</span>
          </button>
        </div>
      </aside>
    </>
  )
}
