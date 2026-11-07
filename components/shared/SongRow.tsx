import { useState } from 'react'
import { Play, Pause, Heart, MoreHorizontal, Download, Loader2, Trash2 } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { useAuthStore } from '@/hooks/useAuth'
import { useDownload } from '@/hooks/useDownload'
import { useLongPress } from '@/hooks/useLongPress'
import { formatTime } from '@/lib/utils/format'
import { QUALITY_LABEL } from '@/lib/quality-options'
import { toast } from '@/lib/toast'
import type { PlaylistMenuEntry } from '@/lib/store/context-menu-store'
import type { Track } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'
import { CoverImage } from './CoverImage'
import { SourceBadge } from './SourceBadge'
import { QualityBadge } from './QualityBadge'
import { DownloadDialog } from './DownloadDialog'

interface SongRowProps {
  track: Track
  queue?: Track[]
  index?: number
  playlistEntry?: PlaylistMenuEntry
  localPlayback?: { quality: QualityType; onRemove: () => void }
}

export function SongRow({ track, queue, index, playlistEntry, localPlayback }: SongRowProps) {
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const effectiveQuality = usePlayerStore(s => s.effectiveQuality)
  const playTrack = usePlayerStore(s => s.playTrack)
  const isFav = useFavoritesStore(s => s.ids.has(track.uid))
  const toggleFav = useFavoritesStore(s => s.toggle)
  const openMenu = useContextMenuStore(s => s.openMenu)
  const isMenuOpen = useContextMenuStore(s => s.menu?.track === track
    && s.menu?.playlistEntry?.playlistId === playlistEntry?.playlistId
    && s.menu?.playlistEntry?.entryId === playlistEntry?.entryId)
  const authenticated = useAuthStore(s => s.authenticated)
  const { download, downloading, error } = useDownload()
  const [downloadOpen, setDownloadOpen] = useState(false)

  const isCurrent = currentTrack?.uid === track.uid && (!localPlayback || effectiveQuality === localPlayback.quality)
  const isCurrentPlaying = isCurrent && isPlaying
  // 行背景由歌曲状态和完整列表索引决定，不依赖虚拟窗口中的 DOM 排位。
  // 当前播放优先于悬停；触屏不会因为触摸而留下悬停背景。
  const rowBackground = isCurrent
    ? 'bg-[color-mix(in_oklch,var(--primary)_9%,var(--card))]'
    : `hoverable:hover:bg-accent/55 ${index != null && index % 2 === 1 ? 'bg-muted/18' : ''}`

  // 触屏长按呼出操作菜单（Spotify/网易云同款），桌面走右键/hover"⋯"
  const longPress = useLongPress((x, y) => { if (!localPlayback) openMenu(track, x, y, playlistEntry) })

  const handlePlay = () => {
    const state = usePlayerStore.getState()
    if (isCurrent && (!localPlayback || (state.streamUrl?.startsWith('blob:') && state.effectiveQuality === localPlayback.quality))) {
      usePlayerStore.getState().togglePlay()
    } else {
      void playTrack(track, queue, { queueIndex: index, ...(localPlayback ? { offline: true, quality: localPlayback.quality } : {}) })
    }
  }

  return <>
    <div
      onContextMenu={e => {
        e.preventDefault()
        if (!localPlayback) openMenu(track, e.clientX, e.clientY, playlistEntry)
      }}
      {...longPress}
      // 触屏禁用长按文本选择/iOS 放大镜（桌面不受影响）
      data-current={isCurrent}
      className={`group flex items-center gap-2 rounded-xl px-2 py-2.5 transition-colors sm:gap-3 sm:px-3 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${rowBackground}`}
    >
      {/* 序号 / 播放按钮 */}
      <div className="relative hidden w-6 shrink-0 items-center justify-center text-sm text-muted-foreground sm:flex">
        {isCurrentPlaying ? (
          <button onClick={handlePlay} aria-label="暂停">
            <Pause className="h-4 w-4 fill-current text-primary" />
          </button>
        ) : (
          <>
            <span aria-hidden="true" className={`hidden hoverable:block hoverable:group-hover:invisible hoverable:group-focus-within:invisible ${isCurrent ? 'text-primary' : ''}`}>
              {index != null ? index + 1 : '♪'}
            </span>
            <button onClick={handlePlay} className="hoverable:absolute hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100" aria-label="播放">
              <Play className="h-4 w-4 fill-current" />
            </button>
          </>
        )}
      </div>

      <button onClick={handlePlay} className="shrink-0" aria-label={`播放 ${track.name}`}>
        <CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="h-10 w-10 rounded-lg shadow-sm" />
      </button>

      <button onClick={handlePlay} className="min-w-0 flex-1 text-left">
        <div className={`flex items-center gap-2 ${isCurrent ? 'text-primary' : ''}`}>
          <span className="truncate text-sm font-medium">{track.name}</span>
          {localPlayback ? <span className="shrink-0 text-[10px] text-muted-foreground">{QUALITY_LABEL[localPlayback.quality]}</span> : <QualityBadge musicInfo={track.musicInfo} />}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{track.artist}</span>
          <SourceBadge source={track.source} />
        </div>
      </button>

      <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground xl:block">
        {track.album}
      </span>

      {!localPlayback && <button
        onClick={() =>
          toggleFav(track.uid).catch(() =>
            toast.error(isFav ? '取消收藏失败，请重试' : '收藏失败，请重试')
          )
        }
        // 触屏常显并保留 44px 点击区域；桌面精细指针使用紧凑按钮。
        className={`flex h-11 w-11 shrink-0 items-center justify-center transition hoverable:h-auto hoverable:w-auto hoverable:p-1 ${
          isFav
            ? 'text-primary'
            : 'text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100'
        }`}
        aria-label={isFav ? '取消收藏' : '收藏'}
        aria-pressed={isFav}
      >
        <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
      </button>}

      {!localPlayback && authenticated && (
        <button
          onClick={() => setDownloadOpen(true)}
          disabled={downloading}
          className={`hidden shrink-0 p-1 transition xl:block ${
            downloading
              ? 'text-primary opacity-100'
              : 'text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100'
          } disabled:opacity-100`}
          aria-label="下载"
          aria-haspopup="dialog"
          title={downloading ? '下载中…' : (error ?? '下载')}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
      )}

      {localPlayback ? <button
        onClick={localPlayback.onRemove}
        className="shrink-0 p-1 text-muted-foreground opacity-70 hover:text-destructive focus-visible:opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100 pointer-coarse:p-3 pointer-coarse:-m-1.5"
        aria-label={`删除 ${track.name} 的本地缓存`}
        title="删除本地缓存"
      ><Trash2 className="h-4 w-4" /></button> : <button
        onClick={e => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openMenu(track, rect.right, rect.bottom, playlistEntry)
        }}
        // 默认常显；支持悬停时按悬停、键盘聚焦或菜单展开状态显现。
        // 触屏扩大命中区（视觉不变，24px→40px），与收藏按钮命中区不重叠
        className="shrink-0 p-1 text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100 hoverable:aria-expanded:opacity-100 pointer-coarse:p-3 pointer-coarse:-m-1.5"
        aria-label="更多操作"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        title="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>}

      <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block sm:w-12">
        {formatTime(track.duration)}
      </span>
    </div>
    {downloadOpen && authenticated && !localPlayback && (
      <DownloadDialog
        key={track.uid}
        track={track}
        onClose={() => setDownloadOpen(false)}
        onDownload={quality => download({ uid: track.uid, quality })}
      />
    )}
  </>
}
