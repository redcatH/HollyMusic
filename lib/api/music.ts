/**
 * 播放 URL 与媒体资源 API
 */

import { apiPost } from './client'
import type { MusicInfo, QualityType } from '@/lib/types/music'

export function getMusicUrl(
  musicInfo: MusicInfo,
  quality: QualityType = '320k'
): Promise<{ url: string }> {
  return apiPost<{ url: string }>('music-url', { musicInfo, quality })
}

/** 构建代理后的播放 URL（解决 CORS） */
export function buildStreamUrl(upstreamUrl: string): string {
  return `/api/proxy/${encodeURIComponent(upstreamUrl)}`
}

/** 构建封面 URL */
export function buildCoverUrl(uid: string): string {
  return `/api/cover/${encodeURIComponent(uid)}`
}
