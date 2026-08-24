import { useRandomSongs } from '@/hooks/useRandomSongs'
import { usePlayerStore } from '@/lib/store/player-store'
import { CoverImage } from '@/components/shared/CoverImage'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { SourceBadge } from '@/components/shared/SourceBadge'
import { QualityBadge } from '@/components/shared/QualityBadge'
import { Play, RefreshCw, Shuffle } from 'lucide-react'
import { toTrack } from '@/lib/types/player'

/** 原首页的本地随机推荐，迁移到侧栏“推荐”菜单。 */
export function RecommendedMusicPage() {
  const { songs, loading, error, reload } = useRandomSongs(30)
  const playTrack = usePlayerStore(s => s.playTrack)
  const tracks = songs.map(song => toTrack({ uid: song.uid, musicInfo: song }))

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="hidden md:block"><h1 className="text-2xl font-bold">推荐</h1><p className="text-sm text-muted-foreground">从你的音乐库随机挑选好歌</p></div>
        <div className="flex gap-2">
          <button onClick={() => tracks[0] && playTrack(tracks[0], tracks)} disabled={tracks.length === 0} className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"><Play className="h-4 w-4 fill-current" /> 播放全部</button>
          <button onClick={reload} className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent"><RefreshCw className="h-4 w-4" /> 换一批</button>
        </div>
      </div>

      {loading ? <LoadingSkeleton count={10} /> : error ? (
        <EmptyState icon={Shuffle} title="加载失败" description={error} />
      ) : tracks.length === 0 ? (
        <EmptyState icon={Shuffle} title="暂无推荐" description="请先搜索或播放一些歌曲，歌曲会自动加入可推荐的音乐库。" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tracks.map(track => (
            <button key={track.uid} onClick={() => playTrack(track, tracks)} className="group flex flex-col gap-2 rounded-lg p-2 text-left hover:bg-accent/40">
              <div className="relative"><CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="aspect-square w-full" /><div className="absolute bottom-2 right-2 translate-y-2 rounded-full bg-primary p-2 text-primary-foreground opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100"><Play className="h-4 w-4 fill-current" /></div></div>
              <div className="truncate text-sm font-medium">{track.name}</div>
              <div className="flex items-center gap-1.5"><span className="truncate text-xs text-muted-foreground">{track.artist}</span><SourceBadge source={track.source} /><QualityBadge musicInfo={track.musicInfo} /></div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
