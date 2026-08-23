/**
 * 音乐播放 URL 获取 API
 * POST /api/music-url
 * Body: { musicInfo: MusicInfo, quality?: QualityType }
 *
 * 需登录（requireUser），未登录返回 401。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { urlCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'
import { musicSourceManager } from '@/lib/music-source-manager'
import { requireUser, AuthError } from '@/lib/services/user-context'
import type { MusicInfo, QualityType } from '@/lib/types/music'

// URL 缓存时间：210 分钟
const URL_CACHE_TTL = 210 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const body = await request.json()
    const { musicInfo, quality = '320k' } = body as {
      musicInfo?: MusicInfo
      quality?: QualityType
    }

    // 参数验证
    if (!musicInfo) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '缺少必填参数: musicInfo',
        400
      )
    }

    if (!musicInfo.name || !musicInfo.singer || !musicInfo.source || !musicInfo.songmid) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        'musicInfo 缺少必填字段: name, singer, source, songmid',
        400
      )
    }

    const validQualities: QualityType[] = ['128k', '320k', 'flac', 'flac24bit']
    if (!validQualities.includes(quality)) {
      return createErrorResponse(
        ErrorCodes.QUALITY_NOT_SUPPORTED,
        `不支持的音质: ${quality}，支持: ${validQualities.join(', ')}`,
        400
      )
    }

    // 生成缓存键
    const cacheKey = `url:${musicInfo.source}:${musicInfo.songmid}:${quality}`

    // 检查缓存
    const cached = urlCache.get(cacheKey)
    if (cached) {
      logger.debug(`URL 缓存命中: ${cacheKey}`)
      return createSuccessResponse({ url: cached })
    }

    logger.info(
      `获取播放 URL: ${musicInfo.name} - ${musicInfo.singer} (${quality})`
    )

    // 确保音源管理器已初始化
    if (!musicSourceManager.isInitialized()) {
      await musicSourceManager.initialize()
    }

    // 获取播放 URL（支持智能降级）
    const url = await musicSourceManager.getMusicUrl(musicInfo, quality)

    // 存入缓存
    urlCache.set(cacheKey, url, URL_CACHE_TTL)
    logger.debug(`URL 已缓存: ${cacheKey}`)

    return createSuccessResponse({ url })
  } catch (error) {
    if (error instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', error.message, 401)
    }
    logger.error('获取播放 URL 失败:', error)

    const errorMessage = error instanceof Error ? error.message : '获取播放链接失败'
    const errorCode = errorMessage.includes('无法获取播放链接')
      ? ErrorCodes.ALL_SOURCES_FAILED
      : ErrorCodes.URL_FETCH_FAILED

    return createErrorResponse(
      errorCode,
      errorMessage,
      500,
      error instanceof Error ? error.stack : undefined
    )
  }
}
