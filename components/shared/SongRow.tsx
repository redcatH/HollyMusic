
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { useAuthStore } from '@/hooks/useAuth'
import { useDownload } from '@/hooks/useDownload'
import { CoverImage } from './CoverImage'
import { SourceBadge } from './SourceBadge'
import { QualityBadge } from './QualityBadge'
import { Play, Pause, Heart, MoreHorizontal, Download, Loader2 } from 'lucide-react'
import { formatTime } from '@/lib/utils/format'
import type { Track } from '@/lib/types/player'

interface SongRowProps {
  track: Track
  queue?: Track[]
  index?: number
  onAddToPlaylist?: (track: Track) => void
}

export function SongRow({ track, queue, index, onAddToPlaylist }: SongRowProps) {
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const playTrack = usePlayerStore(s => s.playTrack)
  const isFav = useFavoritesStore(s => s.ids.has(track.uid))
  const toggleFav = useFavoritesStore(s => s.toggle)
  const authenticated = useAuthStore(s => s.authenticated)
  const { download, downloading, progress } = useDownload()

  const isCurrent = currentTrack?.uid === track.uid
  const isCurrentPlaying = isCurrent && isPlaying

  const handlePlay = () => {
    if (isCurrent) {
      usePlayerStore.getState().togglePlay()
    } else {
      playTrack(track, queue)
    }
  }

  return (
    <div
      className={`group flex items-center gap-3 rounded-md px-2 py-2 ${
        isCurrent ? 'bg-accent/50' : 'hover:bg-accent/30'
      }`}
    >
      {/* 序号 / 播放按钮 */}
      <div className="flex w-6 shrink-0 items-center justify-center text-sm text-muted-foreground">
        {isCurrentPlaying ? (
          <button onClick={handlePlay} aria-label="暂停">
            <Pause className="h-4 w-4 fill-current text-primary" />
          </button>
        ) : (
          <>
            <span className={`group-hover:hidden ${isCurrent ? 'text-primary' : ''}`}>
              {index != null ? index + 1 : '♪'}
            </span>
            <button onClick={handlePlay} className="hidden group-hover:block" aria-label="播放">
              <Play className="h-4 w-4 fill-current" />
            </button>
          </>
        )}
      </div>

      <button onClick={handlePlay} className="shrink-0">
        <CoverImage uid={track.uid} className="h-10 w-10" />
      </button>

      <button onClick={handlePlay} className="min-w-0 flex-1 text-left">
        <div className={`flex items-center gap-2 ${isCurrent ? 'text-primary' : ''}`}>
          <span className="truncate text-sm font-medium">{track.name}</span>
          <QualityBadge musicInfo={track.musicInfo} />
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{track.artist}</span>
          <SourceBadge source={track.source} />
        </div>
      </button>

      <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground sm:block">
        {track.album}
      </span>

      <button
        onClick={() => toggleFav(track.uid).catch(() => {})}
        className={`shrink-0 p-1 transition ${
          isFav
            ? 'text-primary'
            : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
        }`}
        aria-label="收藏"
      >
        <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
      </button>

      {authenticated && (
        <button
          onClick={() => download(track.musicInfo)}
          disabled={downloading}
          className={`hidden shrink-0 p-1 transition md:block ${
            downloading
              ? 'text-primary opacity-100'
              : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
          } disabled:opacity-100`}
          aria-label="下载"
          title={downloading ? (progress != null ? `下载中 ${progress}%` : '下载中…') : '下载'}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
      )}

      {onAddToPlaylist && (
        <button
          onClick={() => onAddToPlaylist(track)}
          className="hidden shrink-0 p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 md:block"
          aria-label="更多"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}

      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatTime(track.duration)}
      </span>
    </div>
  )
}
