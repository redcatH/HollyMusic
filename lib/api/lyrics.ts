/**
 * 歌词 API
 */

import { apiGet } from './client'

export interface LyricsData {
  songId: string
  lyric: string | null
  tlyric: string | null
  hasLyric: boolean
}

export function getLyrics(uid: string): Promise<LyricsData> {
  return apiGet<LyricsData>('lyrics', { id: uid })
}
