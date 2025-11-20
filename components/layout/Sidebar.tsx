'use client'

import { Home, Music, Heart, ListMusic, Settings } from 'lucide-react'
import { usePlayerStore } from '@/lib/store'
import { useState } from 'react'

type MenuItem = {
  id: string
  label: string
  icon: React.ReactNode
  badge?: number
}

export function Sidebar() {
  const { isDarkMode, sidebarOpen } = usePlayerStore()
  const [activeMenu, setActiveMenu] = useState<string>('home')

  const menuItems: MenuItem[] = [
    { id: 'home', label: '首页', icon: <Home className="h-5 w-5" /> },
    { id: 'search', label: '发现音乐', icon: <Music className="h-5 w-5" /> },
    { id: 'favorites', label: '我的收藏', icon: <Heart className="h-5 w-5" /> },
    { id: 'playlists', label: '播放列表', icon: <ListMusic className="h-5 w-5" /> },
  ]

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
        className={`fixed left-0 top-16 bottom-24 z-40 w-64 overflow-y-auto transition-transform lg:relative lg:top-0 lg:translate-x-0 lg:bottom-0 ${
          isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'
        } border-r ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav className="space-y-1 p-4">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
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
              {item.badge !== undefined && (
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold bg-red-500 text-white">
                  {item.badge}
                </span>
              )}
            </button>
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
