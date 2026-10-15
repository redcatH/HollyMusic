import type { QualityType } from '@/lib/types/music'

/**
 * 将 Subsonic 参数转换为共用选档器的偏好。raw 优先；0/缺省表示不限码率。
 * 本服务选择已有音质，不做转码；maxBitRate 是可播放优先的偏好，非严格上限。
 * null 表示非法码率参数。
 */
export function parseSubsonicQualityPreference(params: URLSearchParams): QualityType | null {
  const format = params.get('format')?.trim().toLowerCase()
  if (format === 'raw') return 'flac24bit'

  const rawBitRate = params.get('maxBitRate')?.trim() || '0'
  if (!/^\d+$/.test(rawBitRate)) return null
  const bitRate = Number(rawBitRate)
  if (!Number.isSafeInteger(bitRate)) return null
  if (bitRate > 0) return bitRate >= 320 ? '320k' : '128k'

  return format === 'mp3' ? '320k' : 'flac24bit'
}
