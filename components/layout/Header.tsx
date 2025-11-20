'use client'

import { Menu, Moon, Sun, Search } from 'lucide-react'
import { usePlayerStore } from '@/lib/store'

export function Header() {
  const { isDarkMode, toggleDarkMode, toggleSidebar } = usePlayerStore()

  return (
    <header
      className={`sticky top-0 z-40 border-b ${
        isDarkMode
          ? 'border-gray-800 bg-black'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex h-16 items-center justify-between px-4 lg:px-8">
        {/* 左侧 - 菜单按钮和 Logo */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className={`rounded-lg p-2 transition-colors lg:hidden ${
              isDarkMode
                ? 'hover:bg-gray-900'
                : 'hover:bg-gray-100'
            }`}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-lg ${
                isDarkMode ? 'bg-purple-600' : 'bg-purple-500'
              } flex items-center justify-center`}
            >
              <span className="text-white font-bold text-sm">♪</span>
            </div>
            <h1
              className={`text-xl font-bold hidden sm:block ${
                isDarkMode ? 'text-white' : 'text-black'
              }`}
            >
              LX Music
            </h1>
          </div>
        </div>

        {/* 中央 - 搜索框 */}
        <div className="flex-1 mx-4 lg:mx-8 max-w-md">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              isDarkMode
                ? 'bg-gray-900'
                : 'bg-gray-100'
            }`}
          >
            <Search className="h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="搜索歌曲..."
              className={`flex-1 bg-transparent outline-none text-sm ${
                isDarkMode
                  ? 'text-white placeholder-gray-500'
                  : 'text-black placeholder-gray-400'
              }`}
            />
          </div>
        </div>

        {/* 右侧 - 主题切换按钮 */}
        <button
          onClick={toggleDarkMode}
          className={`rounded-lg p-2 transition-colors ${
            isDarkMode
              ? 'hover:bg-gray-900'
              : 'hover:bg-gray-100'
          }`}
          aria-label="Toggle dark mode"
        >
          {isDarkMode ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>
      </div>
    </header>
  )
}
