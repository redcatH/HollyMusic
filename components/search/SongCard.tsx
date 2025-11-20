'use client'

import { Play, Plus, Heart } from 'lucide-react'
import { getQualityInfo, getSourceInfo, parseSource } from '@/lib/quality-icons'
import { getBestQuality } from '@/lib/quality-utils'
import { usePlayerStore } from '@/lib/store'
import type { MusicInfo } from '@/lib/types/music'

export interface SongCardProps extends MusicInfo {
  onPlay?: () => void
  onAddToPlaylist?: () => void
  onFavorite?: () => void
}

function formatDuration(seconds: number | string): string {
  const sec = typeof seconds === 'string' ? parseInt(seconds) : seconds
  if (!sec || !isFinite(sec)) return '0:00'
  const mins = Math.floor(sec / 60)
  const secs = Math.floor(sec % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function SongCard({
  name,
  singer,
  albumName,
  interval,
  types,
  source,
  img,
  onPlay,
  onAddToPlaylist,
  onFavorite,
}: SongCardProps) {
  const { isDarkMode } = usePlayerStore()
  
  // 从 types 数组中选择最高品质
  const bestQuality = types ? getBestQuality(types) : ('unknown' as const)
  const sourceType = parseSource(source)
  const qualityInfo = getQualityInfo(bestQuality)
  const sourceInfo = getSourceInfo(sourceType)

  return (
    <div
      className={`group flex items-center gap-4 rounded-lg p-3 transition-all hover:shadow-md ${
        isDarkMode
          ? 'hover:bg-gray-800 bg-gray-900/50'
          : 'hover:bg-gray-100 bg-gray-50'
      }`}
    >
      {/* 封面图 */}
      <div className="relative flex-shrink-0 w-12 h-12 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg overflow-hidden flex items-center justify-center group-hover:shadow-lg transition-shadow">
        {img ? (
          <img src={img} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white text-lg">♪</span>
        )}
        
        {/* 播放按钮 - 悬停显示 */}
        <button
          onClick={() => {
            console.log('SongCard: 点击播放按钮', name)
            onPlay?.()
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="播放"
        >
          <Play className="h-5 w-5 text-white fill-white ml-0.5" />
        </button>
      </div>

      {/* 歌曲信息 */}
      <div className="flex-1 min-w-0">
        <h3 className={`text-sm font-medium truncate ${
          isDarkMode ? 'text-white' : 'text-black'
        }`}>
          {name}
        </h3>
        <p className={`text-xs truncate ${
          isDarkMode ? 'text-gray-400' : 'text-gray-600'
        }`}>
          {singer}
        </p>
        {albumName && (
          <p className={`text-xs truncate ${
            isDarkMode ? 'text-gray-500' : 'text-gray-500'
          }`}>
            {albumName}
          </p>
        )}
      </div>

      {/* 品质和音源图标 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* 品质图标 */}
        <div
          className={`flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${
            isDarkMode ? 'bg-gray-800' : 'bg-gray-200'
          } ${qualityInfo.color} title`}
          title={qualityInfo.label}
        >
          {qualityInfo.icon}
        </div>

        {/* 音源图标 */}
        <div
          className={`flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${
            isDarkMode ? 'bg-gray-800' : 'bg-gray-200'
          } ${sourceInfo.color} title`}
          title={sourceInfo.label}
        >
          {sourceInfo.icon}
        </div>
      </div>

      {/* 时长 */}
      <div className={`text-xs font-medium min-w-fit ${
        isDarkMode ? 'text-gray-400' : 'text-gray-600'
      }`}>
        {formatDuration(interval)}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onAddToPlaylist}
          className={`p-1.5 rounded transition-colors ${
            isDarkMode
              ? 'hover:bg-gray-700'
              : 'hover:bg-gray-200'
          }`}
          aria-label="添加到播放列表"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={onFavorite}
          className={`p-1.5 rounded transition-colors ${
            isDarkMode
              ? 'hover:bg-gray-700'
              : 'hover:bg-gray-200'
          }`}
          aria-label="收藏"
        >
          <Heart className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
