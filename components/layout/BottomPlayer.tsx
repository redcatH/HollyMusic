'use client'

import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { usePlayerStore } from '@/lib/store'

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function BottomPlayer() {
  const {
    isDarkMode,
    currentMusic,
    isPlaying,
    currentTime,
    duration,
    volume,
    setIsPlaying,
    setCurrentTime,
    setVolume,
  } = usePlayerStore()

  if (!currentMusic) {
    return (
      <div
        className={`fixed bottom-0 left-0 right-0 h-24 border-t ${
          isDarkMode
            ? 'border-gray-800 bg-gray-950'
            : 'border-gray-200 bg-white'
        } flex items-center justify-center`}
      >
        <p className="text-sm text-gray-500">选择一首歌曲开始播放</p>
      </div>
    )
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 h-24 border-t ${
        isDarkMode
          ? 'border-gray-800 bg-gray-950'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* 进度条 */}
      <div className="h-1 bg-gray-300 dark:bg-gray-700 w-full">
        <div
          className="h-full bg-purple-500 transition-all duration-100"
          style={{
            width: duration ? `${(currentTime / duration) * 100}%` : '0%',
          }}
        />
      </div>

      <div className="flex items-center justify-between px-4 py-3 h-full">
        {/* 左侧 - 歌曲信息 */}
        <div className="flex-1 min-w-0 mr-4">
          <p className={`text-sm font-medium truncate ${
            isDarkMode ? 'text-white' : 'text-black'
          }`}>
            {currentMusic.name}
          </p>
          <p className={`text-xs truncate ${
            isDarkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {currentMusic.artist}
          </p>
        </div>

        {/* 中央 - 播放控制 */}
        <div className="flex items-center gap-4">
          <button
            className={`p-2 rounded-full transition-colors ${
              isDarkMode
                ? 'hover:bg-gray-800'
                : 'hover:bg-gray-100'
            }`}
            aria-label="上一首"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 rounded-full bg-purple-500 text-white hover:bg-purple-600 transition-colors"
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </button>

          <button
            className={`p-2 rounded-full transition-colors ${
              isDarkMode
                ? 'hover:bg-gray-800'
                : 'hover:bg-gray-100'
            }`}
            aria-label="下一首"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        {/* 右侧 - 时间和音量 */}
        <div className="flex items-center gap-4 ml-4 min-w-fit">
          <span className={`text-xs hidden sm:block ${
            isDarkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 hidden sm:block"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
