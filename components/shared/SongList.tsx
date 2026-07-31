'use client'

import { SongRow } from './SongRow'
import type { Track } from '@/lib/types/player'

interface SongListProps {
  tracks: Track[]
  onAddToPlaylist?: (track: Track) => void
}

export function SongList({ tracks, onAddToPlaylist }: SongListProps) {
  if (tracks.length === 0) return null
  return (
    <div className="flex flex-col">
      {tracks.map((t, i) => (
        <SongRow
          key={`${t.uid}-${i}`}
          track={t}
          queue={tracks}
          index={i}
          onAddToPlaylist={onAddToPlaylist}
        />
      ))}
    </div>
  )
}
