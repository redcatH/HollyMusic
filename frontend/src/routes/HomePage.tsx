import { useRandomSongs } from '@/hooks/useRandomSongs'
import { usePlayerStore } from '@/lib/store/player-store'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { useLongPress } from '@/hooks/useLongPress'
import { CoverImage } from '@/components/shared/CoverImage'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { SourceBadge } from '@/components/shared/SourceBadge'
import { QualityBadge } from '@/components/shared/QualityBadge'
import { RefreshCw, Play, Shuffle, MoreHorizontal } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'

export function HomePage() {
  const { songs, loading, error, reload } = useRandomSongs(30)
  const playTrack = usePlayerStore(s => s.playTrack)

  const tracks = songs.map(s => toTrack({ uid: s.uid, musicInfo: s }))
  const playAll = () => {
    if (tracks.length > 0) playTrack(tracks[0], tracks)
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">发现音乐</h1>
          <p className="text-sm text-muted-foreground">精选好歌随机推荐</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={playAll}
            disabled={tracks.length === 0}
            className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-4 w-4 fill-current" /> 播放全部
          </button>
          <button
            onClick={reload}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" /> 换一批
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton count={10} />
      ) : error ? (
        <EmptyState icon={Shuffle} title="加载失败" description={error} />
      ) : tracks.length === 0 ? (
        <EmptyState icon={Shuffle} title="暂无推荐" description="管理员还未添加推荐歌曲" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tracks.map(t => (
            <RecommendCard key={t.uid} track={t} queue={tracks} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 单张推荐卡片：点击播放，"⋯"/右键/长按呼出单曲操作菜单（复用全局 SongContextMenu） */
function RecommendCard({ track, queue }: { track: Track; queue: Track[] }) {
  const playTrack = usePlayerStore(s => s.playTrack)
  const openMenu = useContextMenuStore(s => s.openMenu)
  const longPress = useLongPress((x, y) => openMenu(track, x, y))

  return (
    // 卡片拆两层（按钮嵌按钮非法 HTML）：外层承载右键/长按菜单，内层按钮负责播放
    <div
      className="group relative pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
      onContextMenu={e => {
        e.preventDefault()
        openMenu(track, e.clientX, e.clientY)
      }}
      {...longPress}
    >
      <button
        onClick={() => playTrack(track, queue)}
        className="flex w-full flex-col gap-2 rounded-lg p-2 text-left hover:bg-accent/40"
      >
        <div className="relative">
          <CoverImage uid={track.uid} className="aspect-square w-full" />
          <div className="absolute bottom-2 right-2 translate-y-2 rounded-full bg-primary p-2 text-primary-foreground opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
            <Play className="h-4 w-4 fill-current" />
          </div>
        </div>
        <div className="truncate text-sm font-medium">{track.name}</div>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{track.artist}</span>
          <SourceBadge source={track.source} />
          <QualityBadge musicInfo={track.musicInfo} />
        </div>
      </button>
      <button
        onClick={e => {
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openMenu(track, rect.right, rect.bottom)
        }}
        // 手机常显（触屏无 hover，pointer-fine 不匹配即回落 opacity-70），桌面 hover 显现；
        // 触屏扩大命中区（视觉基本不变，28px→40px）
        className="absolute right-2 top-2 z-10 rounded-full bg-card/80 p-1.5 text-muted-foreground opacity-70 backdrop-blur transition hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-coarse:p-3"
        aria-label="更多操作"
        title="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  )
}
