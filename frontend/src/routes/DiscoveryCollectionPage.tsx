import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Music, Play, RefreshCw } from 'lucide-react'
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

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>
  if (!detail) return <div className="p-6"><EmptyState icon={Music} title="加载失败" description={error || '内容不存在'} /></div>

  return (
    <div className="p-6">
      <div className="mb-6 flex items-end gap-4">
        {detail.cover ? (
          <RemoteCoverImage src={detail.cover} alt="" className="h-32 w-32 shrink-0 rounded-lg object-cover shadow-lg" />
        ) : (
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/50 to-primary/10 shadow-lg"><Music className="h-12 w-12 text-primary-foreground/80" /></div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{kind === 'toplists' ? '排行榜' : '推荐歌单'}</p>
          <h1 className="truncate text-3xl font-bold">{detail.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{detail.author}{detail.updateTime ? ` · 更新于 ${detail.updateTime}` : ''}</p>
          {detail.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{detail.description}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => tracks[0] && playTrack(tracks[0], tracks)} disabled={tracks.length === 0} className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"><Play className="h-4 w-4 fill-current" /> 播放全部</button>
            <button onClick={() => void load()} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      {tracks.length > 0 ? <SongList tracks={tracks} /> : <EmptyState icon={Music} title="暂无可播放歌曲" />}
    </div>
  )
}
