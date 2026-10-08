/**
 * 播放传输按钮：上一首 / 播放暂停 / 下一首。
 * 桌面（PlayerControls）与手机（PlayerBar 行2）共用。
 *
 * 播放/暂停保持圆形实心容器（唯一高权重按钮），上下首用更亮的 foreground/70。
 */

import { usePlayerStore } from '@/lib/store/player-store'
import { Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react'

export function TransportButtons({ size = 'md', compact = false }: { size?: 'sm' | 'md'; compact?: boolean }) {
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const bufferProgress = usePlayerStore(s => s.bufferProgress)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const previous = usePlayerStore(s => s.previous)

  const buffering = bufferProgress !== null
  const side = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const center = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

  return (
    <div className="flex items-center gap-2 desktop:gap-3">
      {!compact && <button
        type="button"
        onClick={previous}
        aria-label="上一首"
        title="上一首"
        className="flex h-10 w-10 items-center justify-center text-foreground/70 transition-colors hover:text-foreground desktop:h-8 desktop:w-8"
      >
        <SkipBack className={`${side} fill-current`} />
      </button>}
      <button
        type="button"
        onClick={togglePlay}
        disabled={buffering}
        aria-label={isPlaying ? '暂停' : '播放'}
        title={isPlaying ? '暂停' : '播放'}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background transition hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 desktop:h-9 desktop:w-9"
      >
        {buffering ? (
          <Loader2 className={`${center} animate-spin`} />
        ) : isPlaying ? (
          <Pause className={`${center} fill-current`} />
        ) : (
          <Play className={`${center} fill-current`} />
        )}
      </button>
      {!compact && <button
        type="button"
        onClick={next}
        aria-label="下一首"
        title="下一首"
        className="flex h-10 w-10 items-center justify-center text-foreground/70 transition-colors hover:text-foreground desktop:h-8 desktop:w-8"
      >
        <SkipForward className={`${side} fill-current`} />
      </button>}
    </div>
  )
}
