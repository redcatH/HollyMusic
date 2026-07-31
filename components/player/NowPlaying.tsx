'use client'

import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { CoverImage } from '@/components/shared/CoverImage'
import { Heart } from 'lucide-react'

export function NowPlaying() {
  const track = usePlayerStore(s => s.currentTrack)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const isFav = useFavoritesStore(s => (track ? s.ids.has(track.uid) : false))
  const toggle = useFavoritesStore(s => s.toggle)

  if (!track) {
    return <div className="hidden md:block md:w-[30%]" />
  }

  return (
    <div className="flex w-full items-center gap-3 md:w-[30%]">
      <button onClick={toggleLyrics} className="shrink-0" aria-label="查看歌词">
        <CoverImage uid={track.uid} className="h-12 w-12 md:h-14 md:w-14" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{track.name}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
      <button
        onClick={() => toggle(track.uid).catch(() => {})}
        className={`shrink-0 p-2 transition-colors ${
          isFav ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
        aria-label="收藏"
      >
        <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
      </button>
    </div>
  )
}
