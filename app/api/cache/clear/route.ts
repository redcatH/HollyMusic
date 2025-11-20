/**
 * 缓存清理 API
 * POST /api/cache/clear
 * Body: { type?: 'all' | 'search' | 'url' }
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { searchCache, urlCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { type = 'all' } = body as { type?: 'all' | 'search' | 'url' }

    const validTypes = ['all', 'search', 'url']
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

    // 清理缓存
    switch (type) {
      case 'all':
        searchCache.clear()
        urlCache.clear()
        logger.info('已清理所有缓存')
        break
      case 'search':
        searchCache.clear()
        logger.info('已清理搜索缓存')
        break
      case 'url':
        urlCache.clear()
        logger.info('已清理 URL 缓存')
        break
    }

    const after = {
      search: searchCache.getStats(),
      url: urlCache.getStats(),
    }

    return createSuccessResponse({
      type,
      before,
      after,
      message: `成功清理${type === 'all' ? '所有' : type === 'search' ? '搜索' : 'URL'}缓存`,
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
