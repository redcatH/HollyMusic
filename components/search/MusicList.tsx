'use client'

import { Loader, AlertCircle } from 'lucide-react'
import { SongCard } from './SongCard'
import { usePlayerStore } from '@/lib/store'
import type { MusicInfo } from '@/lib/types/music'

interface MusicListProps {
  songs: MusicInfo[]
  loading?: boolean
  error?: string | null
  onSongPlay?: (song: MusicInfo) => void
  onSongAddToPlaylist?: (song: MusicInfo) => void
  onSongFavorite?: (song: MusicInfo) => void
  onSongDownload?: (song: MusicInfo) => void
}

export function MusicList({
  songs,
  loading = false,
  error = null,
  onSongPlay,
  onSongAddToPlaylist,
  onSongFavorite,
  onSongDownload,
}: MusicListProps) {
  const { isDarkMode } = usePlayerStore()

  // 加载状态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <div
        className={`rounded-lg p-6 flex items-center gap-3 ${
          isDarkMode
            ? 'bg-red-900/20 border border-red-800'
            : 'bg-red-50 border border-red-200'
        }`}
      >
        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
        <div>
          <h3 className={`font-medium ${isDarkMode ? 'text-red-300' : 'text-red-900'}`}>
            搜索失败
          </h3>
          <p className={`text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>
            {error}
          </p>
        </div>
      </div>
    )
  }

  // 空状态
  if (songs.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className={`text-4xl mb-2 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'}`}>
            ♪
          </div>
          <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
            没有找到相关歌曲
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {songs.map((song, index) => (
        <SongCard
          key={`${song.source}:${song.songmid}:${index}`}
          {...song}
          onPlay={() => onSongPlay?.(song)}
          onAddToPlaylist={() => onSongAddToPlaylist?.(song)}
          onFavorite={() => onSongFavorite?.(song)}
          onDownload={() => onSongDownload?.(song)}
        />
      ))}
    </div>
  )
}
