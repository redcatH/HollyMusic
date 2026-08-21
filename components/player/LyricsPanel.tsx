
import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useLyrics } from '@/hooks/useLyrics'
import { CoverImage } from '@/components/shared/CoverImage'
import { ChevronDown, Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react'

export function LyricsPanel() {
  const isOpen = usePlayerStore(s => s.isLyricsOpen)
  const setLyricsOpen = usePlayerStore(s => s.setLyricsOpen)
  const track = usePlayerStore(s => s.currentTrack)
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const bufferProgress = usePlayerStore(s => s.bufferProgress)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const previous = usePlayerStore(s => s.previous)
  const seek = usePlayerStore(s => s.seek)
  const { lines, activeIndex, hasLyric, loading } = useLyrics(track?.uid, currentTime)

  const activeRef = useRef<HTMLDivElement>(null)
  const buffering = bufferProgress !== null

  // WAI-ARIA 对话框模式：Esc 关闭（歌词面板为全屏页，键盘用户需要退出路径）
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setLyricsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, setLyricsOpen])

  // 当前行变化 → 平滑滚动到中央
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIndex])

  if (!isOpen || !track) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="歌词面板"
    >
      {/* 顶部：极简返回箭头（safe-area 保护，避开状态栏/刘海） */}
      <div className="safe-area-top flex h-14 shrink-0 items-center px-2">
        <button
          onClick={() => setLyricsOpen(false)}
          className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="收起歌词"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
      </div>

      {/* 中部：歌词占据视觉中心 */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        {loading ? (
          <div className="text-center text-muted-foreground">加载歌词...</div>
        ) : hasLyric ? (
          <div className="mx-auto max-w-2xl space-y-5">
            {lines.map((line, i) => {
              // 纯文本回退行 time 为 NaN：不可点击跳转，样式退化为普通文本
              const seekable = Number.isFinite(line.time)
              return (
                <div
                  key={i}
                  ref={i === activeIndex ? activeRef : undefined}
                  onClick={seekable ? () => seek(line.time) : undefined}
                  className={`text-center text-xl transition-all ${
                    seekable ? 'cursor-pointer ' : ''
                  }${
                    i === activeIndex
                      ? 'scale-105 font-bold text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {line.text}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center text-muted-foreground">暂无歌词</div>
        )}
      </div>

      {/* 底部：迷你播放条（封面+歌名/歌手+控制+关闭），safe-area-bottom 避开手势条 */}
      <div className="safe-area-bottom shrink-0 border-t border-border bg-card px-3 py-2">
        {/* 歌曲信息 */}
        <div className="mb-2 flex min-w-0 items-center gap-3">
          <CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{track.name}</div>
            <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
          </div>
        </div>
        {/* 进度条（细线）+ 时间 */}
        <div className="mb-2 flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
          <span className="w-9 text-right">
            {buffering ? `${bufferProgress}%` : formatTimeShort(currentTime)}
          </span>
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200"
              style={{
                width: `${
                  buffering
                    ? bufferProgress
                    : duration > 0
                      ? (currentTime / duration) * 100
                      : 0
                }%`,
              }}
            />
          </div>
          <span className="w-9">
            {buffering ? '加载' : formatTimeShort(duration)}
          </span>
        </div>
        {/* 控制按钮 */}
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={previous}
            className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
            aria-label="上一首"
          >
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            onClick={togglePlay}
            disabled={buffering}
            className="touch-target flex items-center justify-center rounded-full bg-foreground text-background transition hover:scale-105 disabled:opacity-60 disabled:hover:scale-100"
            aria-label="播放/暂停"
          >
            {buffering ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current" />
            )}
          </button>
          <button
            onClick={next}
            className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
            aria-label="下一首"
          >
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** 紧凑时间格式：mm:ss */
function formatTimeShort(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
