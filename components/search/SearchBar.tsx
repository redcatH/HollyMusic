'use client'

import { Search, X } from 'lucide-react'
import { usePlayerStore } from '@/lib/store'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSearch?: (value: string) => void
  loading?: boolean
  sources?: Array<{ value: string; label: string }>
  selectedSource?: string
  onSourceChange?: (source: string) => void
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  loading = false,
  sources = [
    { value: 'kw', label: '酷我' },
    { value: 'kg', label: '酷狗' },
    { value: 'tx', label: 'QQ音乐' },
    { value: 'wy', label: '网易云' },
    { value: 'mg', label: '咪咕' },
  ],
  selectedSource = 'kw',
  onSourceChange,
}: SearchBarProps) {
  const { isDarkMode } = usePlayerStore()

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch?.(value)
    }
  }

  return (
    <div className="space-y-3">
      {/* 搜索框 */}
      <div
        className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-colors ${
          isDarkMode
            ? 'bg-gray-800 border border-gray-700 focus-within:border-purple-500'
            : 'bg-gray-100 border border-gray-200 focus-within:border-purple-500'
        }`}
      >
        <Search className="h-5 w-5 text-gray-500" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="搜索歌曲、艺术家、专辑..."
          disabled={loading}
          className={`flex-1 bg-transparent outline-none text-sm disabled:opacity-50 ${
            isDarkMode
              ? 'text-white placeholder-gray-500'
              : 'text-black placeholder-gray-400'
          }`}
        />
        {value && !loading && (
          <button
            onClick={() => onChange('')}
            className={`p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 transition-colors`}
            aria-label="清空搜索"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {loading && (
          <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* 音源选择 */}
      <div className="flex gap-2 flex-wrap">
        {sources.map((source) => (
          <button
            key={source.value}
            onClick={() => onSourceChange?.(source.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              selectedSource === source.value
                ? 'bg-purple-500 text-white'
                : isDarkMode
                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            disabled={loading}
          >
            {source.label}
          </button>
        ))}
      </div>
    </div>
  )
}
