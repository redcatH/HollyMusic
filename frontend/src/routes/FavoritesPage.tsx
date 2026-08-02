import { useEffect, useState } from 'react'
import { listFavorites, type FavoriteSong } from '@/lib/api/favorites'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { AddToPlaylistDialog } from '@/components/playlists/AddToPlaylistDialog'
import { Heart } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteSong[]>([])
  const [loading, setLoading] = useState(true)
  const [addTrack, setAddTrack] = useState<Track | null>(null)

  // 订阅 favorites version：PlayerBar / SongRow 收藏/取消成功（DB 已提交）后自增，
  // 触发本页重新拉取完整列表，使收藏列表实时变更。
  const favVersion = useFavoritesStore(s => s.version)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listFavorites()
      .then(({ list }) => {
        if (!cancelled) setFavorites(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [favVersion])

  const tracks: Track[] = favorites
    .filter(f => f.musicInfo)
    .map(f => toTrack({ uid: f.songId, musicInfo: f.musicInfo! }))

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">我的收藏</h1>
      {loading ? (
        <LoadingSkeleton />
      ) : tracks.length > 0 ? (
        <SongList tracks={tracks} onAddToPlaylist={t => setAddTrack(t)} />
      ) : (
        <EmptyState icon={Heart} title="还没有收藏" description="点击歌曲旁的心形图标收藏" />
      )}
      {addTrack && <AddToPlaylistDialog uid={addTrack.uid} onClose={() => setAddTrack(null)} />}
    </div>
  )
}
