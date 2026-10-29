/**
 * 音乐搜索 API
 * GET /api/search?source=kw&keyword=xxx&page=1&limit=30
 *
 * 需登录（requireUser），未登录返回 401。
 * 结果会入库（带 checksum 去重）并附加对外 uid，使前端可直接调封面/歌词/收藏。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { searchSongs, SearchStorageError } from '@/lib/services/search-service'
import type { SourceType } from '@/lib/types/music'

export async function GET(request: NextRequest) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const searchParams = request.nextUrl.searchParams
    const source = searchParams.get('source') as SourceType
    const keyword = searchParams.get('keyword')?.trim()
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '30')

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

    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || page < 1 || page > 10_000 || limit < 1 || limit > 100 || keyword.length > 200) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '参数错误: page 为 1–10000 的整数，limit 为 1–100 的整数，关键词不超过 200 字符', 400)
    }

    return createSuccessResponse(await searchSongs(source, keyword, page, limit))
  } catch (error) {
    if (error instanceof SearchStorageError) return createErrorResponse(ErrorCodes.INTERNAL_ERROR, error.message, 500)
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
