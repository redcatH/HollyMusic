/**
 * 音乐搜索 API
 * GET /api/search?source=kw&keyword=xxx&page=1&limit=30
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { searchCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'
import type { SearchResult, SourceType } from '@/lib/types/music'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const musicSearch = require('@/lib/music-core/music-search')

// 搜索缓存时间：30 分钟
const SEARCH_CACHE_TTL = 30 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const source = searchParams.get('source') as SourceType
    const keyword = searchParams.get('keyword')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '30')

    // 参数验证
    if (!source) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '缺少必填参数: source',
        400
      )
    }

    if (!keyword) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '缺少必填参数: keyword',
        400
      )
    }

    const validSources: SourceType[] = ['kw', 'kg', 'tx', 'wy', 'mg']
    if (!validSources.includes(source)) {
      return createErrorResponse(
        ErrorCodes.SOURCE_NOT_SUPPORTED,
        `不支持的音源: ${source}，支持: ${validSources.join(', ')}`,
        400
      )
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '参数错误: page >= 1, 1 <= limit <= 100',
        400
      )
    }

    // 生成缓存键
    const cacheKey = `search:${source}:${keyword}:${page}:${limit}`

    // 检查缓存
    const cached = searchCache.get(cacheKey)
    if (cached) {
      logger.debug(`搜索缓存命中: ${cacheKey}`)
      return createSuccessResponse(cached)
    }

    logger.info(`搜索请求: ${source} - ${keyword} (page: ${page}, limit: ${limit})`)

    // 执行搜索
    const result: SearchResult = await musicSearch.search(source, keyword, page, limit)

    // 存入缓存
    searchCache.set(cacheKey, result, SEARCH_CACHE_TTL)
    logger.debug(`搜索结果已缓存: ${cacheKey} (${result.list.length} 条)`)

    return createSuccessResponse(result)
  } catch (error) {
    logger.error('搜索失败:', error)
    
    return createErrorResponse(
      ErrorCodes.SEARCH_FAILED,
      error instanceof Error ? error.message : '搜索失败',
      500,
      error instanceof Error ? error.stack : undefined
    )
  }
}
