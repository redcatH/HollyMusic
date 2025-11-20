'use client'

import { PlayCircle, PauseCircle, SkipBack, SkipForward, Square } from 'lucide-react'
import { useEffect } from 'react'

interface PlayerControlsProps {
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onPrevious: () => void
  onNext: () => void
  onStop?: () => void
  disabled?: boolean
  hasPrevious?: boolean
  hasNext?: boolean
}

/**
 * 播放器控制按钮组件
 * 支持播放/暂停、上一首、下一首、停止
 * 支持键盘快捷键：空格播放/暂停、<上一首、>下一首
 */
export function PlayerControls({
  isPlaying,
  onPlay,
  onPause,
  onPrevious,
  onNext,
  onStop,
  disabled = false,
  hasPrevious = true,
  hasNext = true,
}: PlayerControlsProps) {
  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // 避免在输入框中触发
      if ((e.target as HTMLElement).tagName === 'INPUT') return

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (disabled) return
          if (isPlaying) {
            onPause()
          } else {
            onPlay()
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (disabled) return
          if (hasPrevious) {
            onPrevious()
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (disabled) return
          if (hasNext) {
            onNext()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isPlaying, onPlay, onPause, onPrevious, onNext, disabled, hasPrevious, hasNext])

  const handlePlayPause = () => {
    if (disabled) return
    if (isPlaying) {
      onPause()
    } else {
      onPlay()
    }
  }

  const handlePrevious = () => {
    if (disabled || !hasPrevious) return
    onPrevious()
  }

  const handleNext = () => {
    if (disabled || !hasNext) return
    onNext()
  }

  return (
    <div className="flex items-center justify-center gap-2 md:gap-4">
      {/* 上一首按钮 */}
      <button
        onClick={handlePrevious}
        disabled={disabled || !hasPrevious}
        className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="上一首 (←)"
        aria-label="上一首"
      >
        <SkipBack className="h-5 w-5 md:h-6 md:w-6" />
      </button>

      {/* 停止按钮 */}
      {onStop && (
        <button
          onClick={onStop}
          disabled={disabled}
          className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="停止"
          aria-label="停止"
        >
          <Square className="h-5 w-5 md:h-6 md:w-6" />
        </button>
      )}

      {/* 播放/暂停按钮 */}
      <button
        onClick={handlePlayPause}
        disabled={disabled}
        className="p-2 rounded-full hover:bg-purple-200 dark:hover:bg-purple-900 bg-purple-100 dark:bg-purple-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
        aria-label={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? (
          <PauseCircle className="h-6 w-6 md:h-8 md:w-8 text-purple-600 dark:text-purple-400" />
        ) : (
          <PlayCircle className="h-6 w-6 md:h-8 md:w-8 text-purple-600 dark:text-purple-400" />
        )}
      </button>

      {/* 下一首按钮 */}
      <button
        onClick={handleNext}
        disabled={disabled || !hasNext}
        className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="下一首 (→)"
        aria-label="下一首"
      >
        <SkipForward className="h-5 w-5 md:h-6 md:w-6" />
      </button>
    </div>
  )
}
