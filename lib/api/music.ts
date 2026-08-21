/**
 * 播放 URL 与媒体资源 API
 */

import { apiGet, apiPost } from './client'
import type { MusicInfo, QualityType } from '@/lib/types/music'

export function getMusicUrl(
  musicInfo: MusicInfo,
  quality: QualityType = '320k'
): Promise<{ url: string }> {
  return apiPost<{ url: string }>('music-url', { musicInfo, quality })
}

/**
 * 构建音频缓存 serve URL。
 * 走 /api/audio，由服务端磁盘缓存 + Range 支持，
 * 浏览器原生 GET + Range，seek/暂停/恢复全程服务端处理。
 */
export function buildAudioUrl(uid: string, quality: QualityType = '320k'): string {
  return `/api/audio?uid=${encodeURIComponent(uid)}&quality=${encodeURIComponent(quality)}`
}

/**
 * 构建封面 URL。
 * cacheKey 通常传当前 musicInfo.img：当音源修正专辑图时，浏览器不会继续使用同 UID 的旧封面缓存。
 */
export function buildCoverUrl(uid: string, cacheKey?: string | null): string {
  const version = cacheKey || '2'
  return `/api/cover/${encodeURIComponent(uid)}?v=${encodeURIComponent(version)}`
}

/** 通过 uid 反查曲目元数据（分享链接 ?uid= 自动播放用） */
export function getTrackByUid(uid: string): Promise<{ uid: string; musicInfo: MusicInfo }> {
  return apiGet('track', { uid })
}
