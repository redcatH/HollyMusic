
import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAppearanceStore } from '@/lib/store/appearance-store'
import { useLyrics } from '@/hooks/useLyrics'
import { CoverImage } from '@/components/shared/CoverImage'
import { AudioSpectrum } from './AudioSpectrum'
import { ChevronDown } from 'lucide-react'
import { SeekBar } from './SeekBar'
import { TransportButtons } from './TransportButtons'

interface LyricsPanelProps {
  audio: HTMLAudioElement | null
}

export function LyricsPanel({ audio }: LyricsPanelProps) {
  const isOpen = usePlayerStore(s => s.isLyricsOpen)
  const coverAtmosphere = useAppearanceStore(s => s.coverAtmosphere)
  const setLyricsOpen = usePlayerStore(s => s.setLyricsOpen)
  const track = usePlayerStore(s => s.currentTrack)
  const currentTime = usePlayerStore(s => s.currentTime)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const seek = usePlayerStore(s => s.seek)
  const { lines, activeIndex, hasLyric, loading } = useLyrics(track?.uid, currentTime)

  const activeRef = useRef<HTMLDivElement>(null)

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
      activeRef.current.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      })
    }
  }, [activeIndex, isOpen])

  if (!isOpen || !track) return null

  return (
    <div
      className={`safe-screen fixed inset-0 z-50 flex flex-col bg-background ${coverAtmosphere ? 'lyrics-atmosphere' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="歌词面板"
    >
      {coverAtmosphere && <div className="lyrics-cover-glow" aria-hidden="true"><CoverImage uid={track.uid} cacheKey={track.musicInfo.img} /></div>}
      {/* 顶部：极简返回箭头（safe-area 保护，避开状态栏/刘海） */}
      <div className="safe-header flex shrink-0 items-center px-2">
        <button
          onClick={() => setLyricsOpen(false)}
          className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="收起歌词"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
      </div>

      {/* 中部：歌词占据视觉中心 */}
      <div className="lyrics-scroll lyrics-layout flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 py-6 desktop:flex-row desktop:items-center desktop:justify-center desktop:gap-16 desktop:overflow-hidden desktop:px-12 desktop:py-8">
        <div className="mx-auto w-36 shrink-0 text-center desktop:mx-0 desktop:w-[min(30vw,22rem)] desktop:text-left">
          <CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="aspect-square w-full rounded-2xl shadow-xl" />
          <h2 className="mt-4 text-base font-semibold desktop:text-2xl">{track.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{track.artist}</p>
        </div>
        <div className="lyrics-scroll lyrics-lines min-h-0 w-full px-3 desktop:h-full desktop:max-w-2xl desktop:flex-1 desktop:overflow-y-auto desktop:py-16">
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
      </div>

      {/* 歌曲信息已在上方展示，底部只保留进度与控制，让背景自然延续。 */}
      <div className="lyrics-controls safe-area-bottom shrink-0 px-5 pt-2 desktop:px-10">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
          <div className="hidden w-full px-10 desktop:block"><AudioSpectrum audio={audio} isPlaying={isPlaying} className="h-3 opacity-70" /></div>
          <div className="flex w-full items-center gap-2"><SeekBar /></div>
          <TransportButtons />
        </div>
      </div>
    </div>
  )
}
