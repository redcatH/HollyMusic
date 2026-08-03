
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
    // 手机占行1剩余空间（让入口按钮靠右），桌面占 30% 保持三栏对齐
    return <div className="flex-1 md:w-[30%] md:flex-none" />
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[30%] md:flex-none">
      <button onClick={toggleLyrics} className="shrink-0" aria-label="查看歌词" title="查看歌词">
        <CoverImage uid={track.uid} className="h-10 w-10 md:h-14 md:w-14" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium md:text-sm">{track.name}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
      <button
        onClick={() => toggle(track.uid).catch(() => {})}
        className={`shrink-0 rounded-md p-2 transition-colors hover:bg-accent ${
          isFav ? 'text-primary' : 'text-foreground/70 hover:text-foreground'
        }`}
        aria-label={isFav ? '取消收藏' : '收藏'}
        title={isFav ? '取消收藏' : '收藏'}
      >
        <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
      </button>
    </div>
  )
}
