
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { CoverImage } from '@/components/shared/CoverImage'
import { Heart, Share2 } from 'lucide-react'
import { QUALITY_LABEL } from '@/lib/quality-options'
import { shareContent, buildSongShareUrl } from '@/lib/share'

export function NowPlaying() {
  const track = usePlayerStore(s => s.currentTrack)
  const effectiveQuality = usePlayerStore(s => s.effectiveQuality)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const isFav = useFavoritesStore(s => (track ? s.ids.has(track.uid) : false))
  const toggle = useFavoritesStore(s => s.toggle)

  if (!track) {
    // 无曲目：占位封面 + 提示，保持三栏对齐且不显空
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[30%] md:flex-none">
        <div className="h-10 w-10 shrink-0 rounded bg-muted md:h-14 md:w-14" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-muted-foreground md:text-sm">未在播放</div>
          <div className="truncate text-xs text-muted-foreground/60">选一首歌开始播放</div>
        </div>
      </div>
    )
  }

  // 实际播放音质（经 resolveQuality 就近降级后的档），与音质按钮的「偏好」分离显示
  const isLossless = effectiveQuality === 'flac' || effectiveQuality === 'flac24bit'

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[30%] md:flex-none">
      <button onClick={toggleLyrics} className="shrink-0" aria-label="查看歌词" title="查看歌词">
        <CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="h-10 w-10 md:h-14 md:w-14" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium md:text-sm">{track.name}</span>
          {effectiveQuality && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isLossless ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              }`}
              title="实际播放音质"
            >
              {QUALITY_LABEL[effectiveQuality]}
            </span>
          )}
        </div>
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
      <button
        onClick={() =>
          shareContent({
            title: track.name,
            text: `${track.name} - ${track.artist}`,
            url: buildSongShareUrl(track.uid),
          })
        }
        className="shrink-0 rounded-md p-2 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        aria-label="分享"
        title="分享"
      >
        <Share2 className="h-4 w-4" />
      </button>
    </div>
  )
}
