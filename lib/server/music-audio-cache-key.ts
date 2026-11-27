import { getStorageSongmidForMusicInfo } from '@/lib/db'
import type { MusicInfo } from '@/lib/types/music'

export function getMusicAudioTrackKey(musicInfo: MusicInfo): string {
  return `${musicInfo.source}:${getStorageSongmidForMusicInfo(musicInfo)}`
}

export function getMusicAudioCacheKeyPrefix(trackKey: string): string {
  return `audio-v2:${trackKey}:`
}
