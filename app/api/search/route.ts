/**
 * 音乐搜索 API
 * GET /api/search?source=kw&keyword=xxx&page=1&limit=30
 *
 * 需登录（requireUser），未登录返回 401。
 * 结果会入库（带 checksum 去重）并附加对外 uid，使前端可直接调封面/歌词/收藏。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { searchCache } from '@/lib/cache-manager'
import { upsertMusicInfosInTransaction, getStorageSongmidForMusicInfo } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireUser, AuthError } from '@/lib/services/user-context'
import type { SearchResult, SourceType, Song } from '@/lib/types/music'
import * as musicSearch from '@/lib/music-core/music-search'

// 搜索缓存时间：210 分钟
const SEARCH_CACHE_TTL = 210 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const searchParams = request.nextUrl.searchParams
    const source = searchParams.get('source') as SourceType
    const keyword = searchParams.get('keyword')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '30')

    // 参数验证
    if (!source) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: source', 400)
    }
    if (!keyword) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: keyword', 400)
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
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '参数错误: page >= 1, 1 <= limit <= 100', 400)
    }

    const cacheKey = `search:${source}:${keyword}:${page}:${limit}`

    const cached = searchCache.get(cacheKey)
    if (cached) {
      logger.debug(`搜索缓存命中: ${cacheKey}`)
      return createSuccessResponse(cached)
    }

    logger.info(`搜索请求: ${source} - ${keyword} (page: ${page}, limit: ${limit})`)

    const result: SearchResult = await musicSearch.search(source, keyword, page, limit)

    // 整页搜索结果在同一事务内顺序写入，避免 SQLite 多写入并发争抢写锁。
    // 入库失败时不返回或缓存无法被播放、歌词等接口查询到的 uid。
    try {
      await upsertMusicInfosInTransaction(result.list)
    } catch (error) {
      logger.error('search music info batch upsert failed', error)
      return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '搜索结果入库失败', 500)
    }

    const list: Song[] = result.list.map((mi) => ({
      ...mi,
      uid: `${mi.source}-${getStorageSongmidForMusicInfo(mi)}`,
    }))
    const enriched = { ...result, list }

    searchCache.set(cacheKey, enriched, SEARCH_CACHE_TTL)
    logger.debug(`搜索结果已缓存: ${cacheKey} (${enriched.list.length} 条)`)

    return createSuccessResponse(enriched)
  } catch (error) {
    if (error instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', error.message, 401)
    }
    logger.error('搜索失败:', error)
    return createErrorResponse(
      ErrorCodes.SEARCH_FAILED,
      error instanceof Error ? error.message : '搜索失败',
      500,
      error instanceof Error ? error.stack : undefined
    )
  }
}
