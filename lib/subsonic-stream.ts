import { NextRequest } from 'next/server'
import { resolveMusicInfoById } from '@/lib/db'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import { musicSourceManager } from '@/lib/music-source-manager'
import { audioServe } from '@/lib/audio-serve'
import { logger } from '@/lib/logger'
import type { MusicInfo, QualityType } from '@/lib/types/music'
import { parseIntervalToSeconds } from '@/lib/types/player'

// ============================================================================
// QUALITY SELECTION
// ============================================================================

/**
 * 根据请求的音质和支持的音质列表，选择最接近的音质
 * 优先级：flac24bit > flac > 320k > 128k
 */
function selectQuality(requestedQuality: QualityType, supportedTypes: QualityType[]): QualityType {
  if (supportedTypes.includes(requestedQuality)) {
    return requestedQuality
  }

  const qualityPriority: QualityType[] = ['flac24bit', 'flac', '320k', '128k']
  for (const q of qualityPriority) {
    if (supportedTypes.includes(q)) {
      logger.debug(`[selectQuality] Requested ${requestedQuality} not available, downgrading to ${q}`)
      return q
    }
  }

  logger.warn(`[selectQuality] No matching quality found, using first available: ${supportedTypes[0]}`)
  return supportedTypes[0]
}

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
  const maxBitRate = parseInt(url.searchParams.get('maxBitRate') || '0', 10)

  try {
    logger.debug(
      `[handleStream] method=${request.method} id=${id} range=${request.headers.get('range')} ua=${request.headers.get('user-agent')}`
    )

    // ========== STEP 1: 解析 id → MusicInfo ==========
    if (!id) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 70, message: 'Missing id' } })
      return createSubsonicResponse(xml)
    }

    const musicInfo = await resolveMusicInfoById(id)
    if (!musicInfo) {
      logger.warn(`[handleStream] Invalid ID: ${id}`)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: 'Invalid song id' },
      })
      return createSubsonicResponse(xml)
    }

    // ========== STEP 2: 验证必填字段 ==========
    const missingFields: string[] = []
    if (!musicInfo.source) missingFields.push('source')
    if (!musicInfo.songmid) missingFields.push('songmid')
    if (!musicInfo.name) missingFields.push('name')
    if (!musicInfo.singer) missingFields.push('singer')
    if (missingFields.length > 0) {
      logger.warn(`[handleStream] Missing fields: ${missingFields.join(', ')}`)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: 'Invalid song info' },
      })
      return createSubsonicResponse(xml)
    }

    // ========== STEP 3: 确定音质 ==========
    let idealQuality: QualityType = '320k'
    if (maxBitRate >= 800) idealQuality = 'flac'
    else if (maxBitRate >= 500) idealQuality = '320k'
    else if (maxBitRate >= 200) idealQuality = '128k'
    else if (maxBitRate > 0) idealQuality = '128k'

    const supportedQualities: QualityType[] = musicInfo.types.map(t => t.type)
    if (supportedQualities.length === 0) {
      logger.warn(`[handleStream] No supported qualities for ${musicInfo.songmid}`)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 0, message: 'No supported audio quality available' },
      })
      return createSubsonicResponse(xml)
    }

    const quality = selectQuality(idealQuality, supportedQualities)
    logger.info(
      `[handleStream] Stream request: ${musicInfo.name} - ${musicInfo.singer} (quality: ${quality})`
    )

    // ========== STEP 4: 委托给 audioServe ==========
    // audioServe 内部处理：
    // - 已缓存 → 本地 Range
    // - 进行中 → attach（不重复打上游）
    // - miss → 调 upstreamUrlResolver 一次，多用户并发也只 1 次
    await audioServe.ensureInitialized()

    const cacheKey = `${musicInfo.source}:${musicInfo.songmid}:${quality}`
    const upstreamUrlResolver = async (): Promise<string> => {
      if (!musicSourceManager.isInitialized()) {
        await musicSourceManager.initialize()
      }
      return musicSourceManager.getMusicUrl(musicInfo as MusicInfo, quality)
    }

    const rangeHeader = request.headers.get('range')
    const response = await audioServe.serve({
      cacheKey,
      upstreamUrlResolver,
      rangeHeader,
      isHead: request.method === 'HEAD',
      intervalSec: parseIntervalToSeconds((musicInfo as MusicInfo).interval),
    })

    // Subsonic 客户端期望失败时返回 XML 错误。
    // audioServe 的错误响应（503/502/416）对原生 <audio> 是正确的，
    // 这里仅对非音频错误响应包一层 XML，避免破坏 Subsonic 协议语义。
    const ct = response.headers.get('content-type') || ''
    if (response.status >= 400 && (ct.includes('application/json') || ct === '')) {
      const body = await response.text().catch(() => '')
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 0, message: `Stream failed: ${response.status} ${body.slice(0, 200)}` },
      })
      return createSubsonicResponse(xml)
    }

    return response
  } catch (err) {
    logger.error('[handleStream] Error:', err instanceof Error ? err.message : String(err))
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 0, message: 'Stream request failed' },
    })
    return createSubsonicResponse(xml)
  }
}
