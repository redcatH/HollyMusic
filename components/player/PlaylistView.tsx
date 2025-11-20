'use client'

import { Trash2, Play } from 'lucide-react'
import { usePlayerStore } from '@/lib/store'

interface PlaylistViewProps {
  onSongSelect?: (songId: string, index: number) => void
  onRemoveSong?: (index: number) => void
}

/**
 * 播放列表视图组件
 * 显示当前播放列表和管理功能
 */
export function PlaylistView({
  onSongSelect,
  onRemoveSong,
}: PlaylistViewProps) {
  const { playlist, currentMusic } = usePlayerStore()

  if (playlist.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        <p className="text-sm">播放列表为空</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {playlist.map((song, index) => (
        <div
          key={`${song.id}-${index}`}
          className={`flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer ${
            currentMusic?.id === song.id && currentMusic?.source === song.source
              ? 'bg-purple-100 dark:bg-purple-900/30'
              : ''
          }`}
          onClick={() => onSongSelect?.(song.id, index)}
        >
          {/* 播放图标 */}
          {currentMusic?.id === song.id && currentMusic?.source === song.source && (
            <Play className="h-4 w-4 text-purple-500 flex-shrink-0" />
          )}

          {/* 歌曲信息 */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{song.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {song.artist}
            </p>
          </div>

          {/* 移除按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemoveSong?.(index)
            }}
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100"
            title="移除"
            aria-label="移除"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      ))}
    </div>
  )
}
