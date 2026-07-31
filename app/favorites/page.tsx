'use client'

import { useEffect, useState } from 'react'
import { listFavorites, type FavoriteSong } from '@/lib/api/favorites'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { AddToPlaylistDialog } from '@/components/playlists/AddToPlaylistDialog'
import { Heart } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteSong[]>([])
  const [loading, setLoading] = useState(true)
  const [addTrack, setAddTrack] = useState<Track | null>(null)

  useEffect(() => {
    listFavorites()
      .then(({ list }) => setFavorites(list))
      .finally(() => setLoading(false))
  }, [])

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
