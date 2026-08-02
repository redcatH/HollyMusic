import { useParams, useNavigate } from 'react-router-dom'
import { usePlaylistDetail } from '@/hooks/usePlaylistDetail'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Play, Trash2, Music } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack, type Track } from '@/lib/types/player'
import { deletePlaylist } from '@/lib/api/playlists'

export function PlaylistDetailPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const id = parseInt(idStr ?? '0', 10)
  const { detail, loading } = usePlaylistDetail(id)
  const playTrack = usePlayerStore(s => s.playTrack)
  const navigate = useNavigate()

  const tracks: Track[] = (detail?.entries ?? [])
    .filter(e => e.musicInfo)
    .map(e => toTrack({ uid: e.songId, musicInfo: e.musicInfo! }))

  const handleDelete = async () => {
    if (!confirm('删除该歌单？')) return
    try {
      await deletePlaylist(id)
      navigate('/playlists')
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="p-6">
      {loading ? (
        <LoadingSkeleton />
      ) : !detail ? (
        <EmptyState icon={Music} title="歌单不存在" />
      ) : (
        <>
          <div className="mb-6 flex items-end gap-4">
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded bg-gradient-to-br from-primary/30 to-primary/10">
              <Music className="h-12 w-12 text-primary/70" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold">{detail.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {detail.songCount} 首 · {detail.username}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => tracks.length > 0 && playTrack(tracks[0], tracks)}
                  disabled={tracks.length === 0}
                  className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4 fill-current" /> 播放全部
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> 删除歌单
                </button>
              </div>
            </div>
          </div>
          {tracks.length > 0 ? (
            <SongList tracks={tracks} />
          ) : (
            <EmptyState icon={Music} title="歌单为空" description="去搜索并添加歌曲" />
          )}
        </>
      )}
    </div>
  )
}
