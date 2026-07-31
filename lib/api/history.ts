/**
 * 播放历史 API
 */

import { apiGet, apiPost, apiDelete } from './client'
import type { MusicInfo } from '@/lib/types/music'

export interface HistoryEntry {
  id: number
  songId: string | null
  musicInfo: MusicInfo | null
  playedAt: string
}

export function listHistory(
  limit = 100,
  offset = 0
): Promise<{ list: HistoryEntry[]; total: number }> {
  return apiGet('history', { limit, offset })
}

export function reportPlay(musicInfo: MusicInfo): Promise<{ reported: boolean }> {
  return apiPost('history', { musicInfo })
}

export function clearHistory(): Promise<{ deleted: number }> {
  return apiDelete('history')
}
