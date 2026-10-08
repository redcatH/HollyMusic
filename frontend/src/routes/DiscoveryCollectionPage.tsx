import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Music, Play, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { RemoteCoverImage } from '@/components/shared/RemoteCoverImage'
import { SongList } from '@/components/shared/SongList'
import { getRecommendedPlaylistDetail, getToplistDetail } from '@/lib/api/discovery'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'
import type { DiscoveryCollectionDetail, DiscoverySource } from '@/lib/services/discovery-service'

export function DiscoveryCollectionPage({ kind }: { kind: 'toplists' | 'playlists' }) {
  const { id = '' } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const sourceParam = searchParams.get('source')
  const source: DiscoverySource = sourceParam === 'wy' || sourceParam === 'kw' || sourceParam === 'kg' || sourceParam === 'mg' ? sourceParam : 'tx'
  const [detail, setDetail] = useState<DiscoveryCollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const playTrack = usePlayerStore(s => s.playTrack)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = kind === 'toplists' ? await getToplistDetail(source, id) : await getRecommendedPlaylistDetail(source, id)
      setDetail(result)
    } catch (err) {
      setDetail(null)
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // id / kind 变化时重新请求；load 是本组件内函数，无需作为依赖项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, source])

  const tracks = useMemo(() => (detail?.tracks ?? []).map(song => toTrack({ uid: song.uid, musicInfo: song })), [detail])

  if (loading) return <div className="page-shell"><LoadingSkeleton /></div>
  if (!detail) return <div className="page-shell"><EmptyState icon={Music} title="加载失败" description={error || '内容不存在'} /></div>

  return (
    <div className="page-shell">
      <Link to={`/?source=${source}`} className="mb-5 inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ChevronLeft className="h-4 w-4" /> 发现音乐</Link>
      <div className="feature-surface mb-7 flex items-start gap-3 rounded-3xl border border-border/50 p-4 sm:items-center sm:gap-6 sm:p-7">
        {detail.cover ? (
          <RemoteCoverImage src={detail.cover} alt="" className="cover-elevation h-20 w-20 shrink-0 rounded-2xl object-cover sm:h-40 sm:w-40 lg:h-44 lg:w-44" />
        ) : (
          <div className="cover-elevation flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 sm:h-40 sm:w-40 lg:h-44 lg:w-44"><Music className="h-8 w-8 text-primary sm:h-12 sm:w-12" /></div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wider text-primary">{kind === 'toplists' ? '排行榜' : '推荐歌单'}</p>
          <h1 className="mt-2 break-words text-2xl font-bold leading-tight tracking-tight lg:text-4xl">{detail.name}</h1>
          <p className="mt-3 text-xs text-muted-foreground sm:text-sm">{detail.author}{detail.updateTime ? ` · 更新于 ${detail.updateTime}` : ''}</p>
          {detail.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">{detail.description}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={() => tracks[0] && playTrack(tracks[0], tracks)} disabled={tracks.length === 0} className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"><Play className="h-4 w-4 fill-current" /> 播放全部</button>
            <button onClick={() => void load()} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      <div className="mb-3 flex items-baseline gap-2"><h2 className="section-title">歌曲</h2><span className="text-xs text-muted-foreground">{tracks.length} 首</span></div>
      {tracks.length > 0 ? <SongList tracks={tracks} /> : <EmptyState icon={Music} title="暂无可播放歌曲" />}
    </div>
  )
}
