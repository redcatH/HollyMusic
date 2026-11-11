import { memo, useCallback, useMemo } from 'react'
import { VirtualList } from './VirtualList'
import { SongRow } from './SongRow'
import type { Track } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'

interface SongListProps {
  tracks: Track[]
  history?: { entryIds: number[]; onRemove: (id: number) => Promise<void> }
  localPlayback?: { qualities: QualityType[]; onRemove: (index: number) => void }
  playlist?: {
    id: number
    entryIds: number[]
    onRemoved: () => Promise<void>
  }
}

const SongListItem = memo(function SongListItem({ track, queue, index, playlist, localPlayback, history }: {
  track: Track
  queue: Track[]
  index: number
  playlist: SongListProps['playlist']
  localPlayback: SongListProps['localPlayback']
  history: SongListProps['history']
}) {
  return <SongRow
    track={track}
    queue={queue}
    index={index}
    historyEntry={history ? { id: history.entryIds[index], onRemove: history.onRemove } : undefined}
    localPlayback={localPlayback ? { quality: localPlayback.qualities[index], onRemove: () => localPlayback.onRemove(index) } : undefined}
    playlistEntry={playlist ? { playlistId: playlist.id, entryId: playlist.entryIds[index], onRemoved: playlist.onRemoved } : undefined}
  />
})

function trackKey(track: Track, index: number): string {
  return `${track.uid}-${index}`
}

export const SongList = memo(function SongList({ tracks, playlist, localPlayback, history }: SongListProps) {
  const playbackTracks = useMemo<Track[]>(() => localPlayback
    ? tracks.map((track, index) => ({ ...track, playback: { source: 'local', quality: localPlayback.qualities[index] } }))
    : tracks, [tracks, localPlayback])
  const renderTrack = useCallback((track: Track, index: number) => <SongListItem
    track={track} queue={playbackTracks} index={index} playlist={playlist} localPlayback={localPlayback} history={history}
  />, [playbackTracks, playlist, localPlayback, history])

  if (tracks.length === 0) return null
  return <VirtualList items={playbackTracks} itemKey={trackKey} renderItem={renderTrack}
    estimateRowHeight={60} gap={2} className="track-list" />
})
