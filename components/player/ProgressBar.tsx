'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

interface ProgressBarProps {
  currentTime: number
  duration: number
  onSeek: (time: number) => void
  disabled?: boolean
  isLoading?: boolean
  showTime?: boolean
}

/**
 * 格式化时间为 MM:SS 格式
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00'

  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * 进度条组件
 * 支持拖动进度、显示实时时间、禁用状态
 */
export function ProgressBar({
  currentTime,
  duration,
  onSeek,
  disabled = false,
  isLoading = false,
  showTime = true,
}: ProgressBarProps) {
  const progressRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  // 计算进度百分比
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // 处理进度条点击或拖动
  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (disabled || duration === 0) return

      const progressBar = progressRef.current
      if (!progressBar) return

      const rect = progressBar.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const newTime = percent * duration

      onSeek(newTime)
    },
    [disabled, duration, onSeek]
  )

  // 处理鼠标按下
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    setIsDragging(true)
    handleSeek(e)
  }

  // 处理鼠标移动（全局）
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      const mouseEvent = e as unknown as React.MouseEvent<HTMLDivElement>
      handleSeek(mouseEvent)
    },
    [isDragging, handleSeek]
  )

  // 处理鼠标释放（全局）
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // 注册全局事件监听
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)

      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // 处理 Hover 显示时间
  const handleHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || duration === 0) {
      setHoverTime(null)
      return
    }

    const progressBar = progressRef.current
    if (!progressBar) return

    const rect = progressBar.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverTime(percent * duration)
  }

  const handleMouseLeave = () => {
    setHoverTime(null)
  }

  return (
    <div className="flex items-center gap-2 w-full">
      {/* 当前时间 */}
      {showTime && (
        <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[36px]">
          {formatTime(currentTime)}
        </span>
      )}

      {/* 进度条容器 */}
      <div
        ref={progressRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleHover}
        onMouseLeave={handleMouseLeave}
        className={`flex-1 h-1 bg-gray-300 dark:bg-gray-600 rounded-full overflow-hidden cursor-pointer relative group transition-all ${
          isDragging ? 'h-2' : ''
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {/* 进度条背景 */}
        <div
          className={`h-full rounded-full transition-all ${
            isLoading
              ? 'bg-gradient-to-r from-purple-400 to-purple-600 animate-pulse'
              : 'bg-gradient-to-r from-purple-500 to-purple-600'
          }`}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />

        {/* 进度圆点 */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white dark:bg-gray-100 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity ${
            isDragging ? 'opacity-100' : ''
          }`}
          style={{ left: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>

      {/* 总时长 */}
      {showTime && (
        <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[36px] text-right">
          {formatTime(duration)}
        </span>
      )}

      {/* Hover 时间提示 */}
      {hoverTime !== null && showTime && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 dark:bg-gray-200 text-white dark:text-black text-xs rounded whitespace-nowrap pointer-events-none">
          {formatTime(hoverTime)}
        </div>
      )}
    </div>
  )
}
