'use client'

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useLyrics } from '@/hooks/useLyrics'
import { CoverImage } from '@/components/shared/CoverImage'
import { X } from 'lucide-react'

export function LyricsPanel() {
  const isOpen = usePlayerStore(s => s.isLyricsOpen)
  const setLyricsOpen = usePlayerStore(s => s.setLyricsOpen)
  const track = usePlayerStore(s => s.currentTrack)
  const currentTime = usePlayerStore(s => s.currentTime)
  const seek = usePlayerStore(s => s.seek)
  const { lines, activeIndex, hasLyric, loading } = useLyrics(track?.uid, currentTime)

  const activeRef = useRef<HTMLDivElement>(null)

  // 当前行变化 → 平滑滚动到中央
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIndex])

  if (!isOpen || !track) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <CoverImage uid={track.uid} className="h-12 w-12" />
          <div>
            <div className="font-medium">{track.name}</div>
            <div className="text-sm text-muted-foreground">{track.artist}</div>
          </div>
        </div>
        <button onClick={() => setLyricsOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="关闭">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-8">
        {loading ? (
          <div className="text-center text-muted-foreground">加载歌词...</div>
        ) : hasLyric ? (
          <div className="mx-auto max-w-2xl space-y-5">
            {lines.map((line, i) => (
              <div
                key={i}
                ref={i === activeIndex ? activeRef : undefined}
                onClick={() => seek(line.time)}
                className={`cursor-pointer text-center text-xl transition-all ${
                  i === activeIndex
                    ? 'scale-105 font-bold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {line.text}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground">暂无歌词</div>
        )}
      </div>
    </div>
  )
}
