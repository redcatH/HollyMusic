import { useEffect, useState } from 'react'
import { listFavorites, type FavoriteSong } from '@/lib/api/favorites'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Heart } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteSong[]>([])
  const [loading, setLoading] = useState(true)

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
      <h1 className="mb-4 hidden text-2xl font-bold md:block">我的收藏</h1>
      {loading ? (
        <LoadingSkeleton />
      ) : tracks.length > 0 ? (
        <SongList tracks={tracks} />
      ) : (
        <EmptyState icon={Heart} title="还没有收藏" description="点击歌曲旁的心形图标收藏" />
      )}
    </div>
  )
}
