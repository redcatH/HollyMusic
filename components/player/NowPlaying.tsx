
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { CoverImage } from '@/components/shared/CoverImage'
import { Heart, Music2, Share2 } from 'lucide-react'
import { QUALITY_LABEL } from '@/lib/quality-options'
import { shareContent, buildSongShareUrl } from '@/lib/share'
import { toast } from '@/lib/toast'

export function NowPlaying() {
  const track = usePlayerStore(s => s.currentTrack)
  const effectiveQuality = usePlayerStore(s => s.effectiveQuality)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const isFav = useFavoritesStore(s => (track ? s.ids.has(track.uid) : false))
  const toggle = useFavoritesStore(s => s.toggle)

  if (!track) {
    // 无曲目：占位封面 + 提示，保持三栏对齐且不显空
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3 desktop:flex-none">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary/60 desktop:h-12 desktop:w-12"><Music2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-muted-foreground desktop:text-sm">未在播放</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">选一首歌，让音乐开始</div>
        </div>
      </div>
    )
  }

  // 实际播放音质（经 resolveQuality 就近降级后的档），与音质按钮的「偏好」分离显示
  const isLossless = effectiveQuality === 'flac' || effectiveQuality === 'flac24bit'

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 desktop:flex-none lg:gap-3">
      <button onClick={toggleLyrics} className="shrink-0" aria-label="查看歌词" title="查看歌词">
        <CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="h-10 w-10 rounded-xl shadow-sm desktop:h-12 desktop:w-12" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{track.name}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{track.artist}</span>
          {effectiveQuality && (
            <span
              className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium desktop:inline ${
                isLossless ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              }`}
              title="实际播放音质"
            >
              {QUALITY_LABEL[effectiveQuality]}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() =>
          toggle(track.uid).catch(() =>
            toast.error(isFav ? '取消收藏失败，请重试' : '收藏失败，请重试')
          )
        }
        className={`hidden shrink-0 rounded-md p-2 transition-colors hover:bg-accent desktop:block ${
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
        className="hidden shrink-0 rounded-md p-2 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground desktop:block"
        aria-label="分享"
        title="分享"
      >
        <Share2 className="h-4 w-4" />
      </button>
    </div>
  )
}
