import { NextRequest } from 'next/server'
import { resolveMusicInfoById } from '@/lib/db'
import { subsonicError } from '@/lib/subsonic'
import { getAvailableQualities, QUALITY_ORDER, resolveQuality } from '@/lib/quality-options'
import { getSubsonicStereoPreference, parseSubsonicQualityPreference } from '@/lib/subsonic-quality'
import { logger } from '@/lib/logger'
import { serveMusicAudio } from '@/lib/server/music-audio'
import { enrichAudioDetails } from '@/lib/server/platform-audio-details'

// ============================================================================
// STREAM HANDLER
// ============================================================================

/**
 * Subsonic /rest/stream.view 流处理器。
 *
 * 2026-08 重构：复用 lib/audio-serve 的统一音频缓存管线
 * （内存进行中去重 + 边下边写盘 + Range seek + LRU）。
 */
export async function handleStream(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || ''
  const preference = parseSubsonicQualityPreference(url.searchParams)

  try {
    logger.debug(
      `[handleStream] method=${request.method} id=${id} range=${request.headers.get('range')} ua=${request.headers.get('user-agent')}`
    )

    // ========== STEP 1: 解析 id → MusicInfo ==========
    if (!id) {
      return subsonicError(request, 70, 'Missing id')
    }
    if (preference === null) {
      return subsonicError(request, 10, 'Invalid maxBitRate: expected a non-negative safe integer')
    }

    const storedMusicInfo = await resolveMusicInfoById(id)
    if (!storedMusicInfo) {
      logger.warn(`[handleStream] Invalid ID: ${id}`)
      return subsonicError(request, 70, 'Invalid song id')
    }

    // ========== STEP 2: 验证必填字段 ==========
    const missingFields: string[] = []
    if (!storedMusicInfo.source) missingFields.push('source')
    if (!storedMusicInfo.songmid) missingFields.push('songmid')
    if (!storedMusicInfo.name) missingFields.push('name')
    if (!storedMusicInfo.singer) missingFields.push('singer')
    if (missingFields.length > 0) {
      logger.warn(`[handleStream] Missing fields: ${missingFields.join(', ')}`)
      return subsonicError(request, 70, 'Invalid song info')
    }

    // ========== STEP 3: 确定音质 ==========
    const musicInfo = await enrichAudioDetails(storedMusicInfo, preference)
    const supportedQualities = getAvailableQualities(musicInfo.types).filter(q =>
      QUALITY_ORDER.includes(q) && (q !== 'master' || getSubsonicStereoPreference() === 'master'))
    if (supportedQualities.length === 0) {
      logger.warn(`[handleStream] No supported qualities for ${musicInfo.songmid}`)
      return subsonicError(request, 0, 'No supported audio quality available')
    }

    const quality = resolveQuality(preference, musicInfo.types)
    logger.debug('[handleStream] Quality selection', {
      format: url.searchParams.get('format'),
      maxBitRate: url.searchParams.get('maxBitRate'),
      preference,
      quality,
    })
    logger.info(
      `[handleStream] Stream request: ${musicInfo.name} - ${musicInfo.singer} (quality: ${quality})`
    )

    const response = await serveMusicAudio({
      musicInfo, quality,
      rangeHeader: request.headers.get('range'),
      isHead: request.method === 'HEAD',
    })

    // Subsonic 客户端期望失败时返回 XML 错误。
    // audioServe 的错误响应（503/502/416）对原生 <audio> 是正确的，
    // 这里仅对非音频错误响应包一层 XML，避免破坏 Subsonic 协议语义。
    const ct = response.headers.get('content-type') || ''
    if (response.status >= 400 && response.status !== 416 && (ct.includes('application/json') || ct === '')) {
      const body = await response.text().catch(() => '')
      return subsonicError(request, 0, `Stream failed: ${response.status} ${body.slice(0, 200)}`)
    }

    return response
  } catch (err) {
    logger.error('[handleStream] Error:', err instanceof Error ? err.message : String(err))
    return subsonicError(request, 0, 'Stream request failed')
  }
}
