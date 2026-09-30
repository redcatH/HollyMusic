
import { SongRow } from './SongRow'
import type { Track } from '@/lib/types/player'

interface SongListProps {
  tracks: Track[]
  playlist?: {
    id: number
    entryIds: number[]
    onRemoved: () => Promise<void>
  }
}

export function SongList({ tracks, playlist }: SongListProps) {
  if (tracks.length === 0) return null
  return (
    <div className="flex flex-col">
      {tracks.map((t, i) => (
        <SongRow
          key={`${t.uid}-${i}`}
          track={t}
          queue={tracks}
          index={i}
          playlistEntry={playlist ? {
            playlistId: playlist.id,
            entryId: playlist.entryIds[i],
            onRemoved: playlist.onRemoved,
          } : undefined}
        />
      ))}
    </div>
  )
}
