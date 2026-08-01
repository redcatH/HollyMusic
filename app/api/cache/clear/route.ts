/**
 * 缓存清理 API
 * POST /api/cache/clear
 * Body: { type?: 'all' | 'search' | 'url' | 'audio' }
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { searchCache, urlCache } from '@/lib/cache-manager'
import { clearAllAudioCache } from '@/lib/server/audio-cache'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { type = 'all' } = body as { type?: 'all' | 'search' | 'url' | 'audio' }

    const validTypes = ['all', 'search', 'url', 'audio']
    if (!validTypes.includes(type)) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        `无效的 type 参数: ${type}，支持: ${validTypes.join(', ')}`,
        400
      )
    }

    const before = {
      search: searchCache.getStats(),
      url: urlCache.getStats(),
    }

    let audioResult: { count: number; bytes: number } | null = null

    // 清理缓存
    switch (type) {
      case 'all':
        searchCache.clear()
        urlCache.clear()
        audioResult = await clearAllAudioCache().catch(() => null)
        logger.info('已清理所有缓存（含音频磁盘缓存）')
        break
      case 'search':
        searchCache.clear()
        logger.info('已清理搜索缓存')
        break
      case 'url':
        urlCache.clear()
        logger.info('已清理 URL 缓存')
        break
      case 'audio':
        audioResult = await clearAllAudioCache().catch(() => null)
        logger.info('已清理音频磁盘缓存')
        break
    }

    const after = {
      search: searchCache.getStats(),
      url: urlCache.getStats(),
    }

    const typeLabel: Record<string, string> = {
      all: '所有',
      search: '搜索',
      url: 'URL',
      audio: '音频磁盘',
    }

    return createSuccessResponse({
      type,
      before,
      after,
      audio: audioResult,
      message: `成功清理${typeLabel[type]}缓存`,
    })
  } catch (error) {
    logger.error('清理缓存失败:', error)

    return createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      error instanceof Error ? error.message : '清理缓存失败',
      500,
      error instanceof Error ? error.stack : undefined
    )
  }
}
