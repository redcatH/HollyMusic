'use client'

import { useState } from 'react'
import { Trash2, Play, Clock, TrendingUp } from 'lucide-react'
import { usePlayHistory } from '@/hooks/usePlayHistory'
import { usePlayerStore } from '@/lib/store'
import type { MusicInfo } from '@/lib/types/music'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { getBestQuality } from '@/lib/quality-utils'
import { getQualityInfo, getSourceInfo, parseSource } from '@/lib/quality-icons'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface HistoryListProps {
  sortBy?: 'time' | 'count'
}

export function HistoryList({ sortBy = 'time' }: HistoryListProps) {
  const { history, loading, removeHistory } = usePlayHistory(sortBy)
  const { currentMusic, loadMusicAndUrl, isDarkMode } = usePlayerStore()

  const handlePlay = async (musicInfo: MusicInfo) => {
    console.log('HistoryList: 播放历史记录', musicInfo)

    // 从 types 中选择最高品质
    const quality = musicInfo.types?.[musicInfo.types.length - 1]?.type || '128k'

    // 直接使用保存的完整 MusicInfo 加载音乐
    await loadMusicAndUrl(musicInfo, quality)
  }

  const handleRemove = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await removeHistory(id)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin">
          <svg className="h-8 w-8 text-purple-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className={`text-4xl mb-2 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'}`}>
            ♪
          </div>
          <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
            暂无播放记录
          </p>
          <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            播放过的歌曲会自动保存到这里
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {history.map((item) => {
        const song = item.musicInfo
        const isCurrentPlaying = currentMusic?.id === song.songmid && currentMusic?.source === song.source
        const bestQuality = song.types ? getBestQuality(song.types) : ('unknown' as const)
        const sourceType = parseSource(song.source)
        const qualityInfo = getQualityInfo(bestQuality)
        const sourceInfo = getSourceInfo(sourceType)

        return (
          <div
            key={item.id}
            className={`group flex items-center gap-3 md:gap-4 rounded-lg p-2 md:p-3 transition-all hover:shadow-md ${
              isDarkMode
                ? 'hover:bg-gray-800 bg-gray-900/50'
                : 'hover:bg-gray-100 bg-gray-50'
            }`}
            onClick={() => handlePlay(song)}
          >
            <div
              className="relative flex-shrink-0 w-12 h-12 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg overflow-hidden flex items-center justify-center"
            >
              {song.img ? (
                <img src={song.img} alt={song.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-lg">♪</span>
              )}

              {isCurrentPlaying ? (
                <div className="absolute inset-0 flex items-center justify-center bg-purple-600/80">
                  <div className="flex gap-0.5">
                    <div className="w-1 h-4 bg-white animate-pulse" style={{ animationDelay: '0s' }} />
                    <div className="w-1 h-6 bg-white animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <div className="w-1 h-3 bg-white animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePlay(song)
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  aria-label="播放"
                >
                  <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                </button>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className={`text-sm font-medium truncate ${
                isDarkMode ? 'text-white' : 'text-black'
              }`}>
                {song.name}
              </h3>
              <p className={`text-xs truncate ${
                isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {song.singer}
              </p>
              {song.albumName && (
                <p className={`text-xs truncate hidden md:block ${
                  isDarkMode ? 'text-gray-500' : 'text-gray-500'
                }`}>
                  {song.albumName}
                </p>
              )}
            </div>

            <div className="items-center gap-1.5 flex-shrink-0 hidden md:flex">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${
                  isDarkMode ? 'bg-gray-800' : 'bg-gray-200'
                } ${qualityInfo.color}`}
                title={qualityInfo.label}
              >
                {qualityInfo.icon}
              </div>
              <div
                className={`flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${
                  isDarkMode ? 'bg-gray-800' : 'bg-gray-200'
                } ${sourceInfo.color}`}
                title={sourceInfo.label}
              >
                {sourceInfo.icon}
              </div>
            </div>

            <div className={`text-xs font-medium min-w-fit hidden md:block ${
              isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {song.interval}
            </div>

            <div className={`text-xs min-w-fit hidden md:block ${
              isDarkMode ? 'text-gray-500' : 'text-gray-500'
            }`}>
              {sortBy === 'time' ? (
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {dayjs(item.lastPlayedAt).fromNow()}
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {item.playCount} 次
                </div>
              )}
            </div>

            <button
              onClick={(e) => handleRemove(item.id!, e)}
              className={`p-1.5 rounded transition-colors opacity-0 md:opacity-0 md:group-hover:opacity-100 ${
                isDarkMode
                  ? 'hover:bg-gray-700'
                  : 'hover:bg-gray-200'
              }`}
              title="删除记录"
              aria-label="删除记录"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
