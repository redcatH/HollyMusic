/**
 * 收藏 API
 */

import { apiGet, apiPost, apiDelete } from './client'
import type { MusicInfo } from '@/lib/types/music'

export interface FavoriteSong {
  songId: string
  source: string | null
  starredAt: string
  musicInfo: MusicInfo | null
}

export function listFavorites(
  limit = 200,
  offset = 0
): Promise<{ list: FavoriteSong[]; total: number }> {
  return apiGet('favorites', { limit, offset })
}

export function starSong(uid: string): Promise<{ starred: boolean }> {
  return apiPost('favorites', { id: uid })
}

export function unstarSong(uid: string): Promise<{ starred: boolean }> {
  return apiDelete('favorites', { id: uid })
}

export function checkStarred(uid: string): Promise<{ starred: boolean }> {
  return apiGet('favorites/check', { id: uid })
}
