/**
 * 随机歌曲 API
 */

import { apiGet } from './client'
import type { Song } from '@/lib/types/music'

export function getRandomSongs(size = 30): Promise<{ list: Song[]; size: number }> {
  return apiGet('random', { size })
}
