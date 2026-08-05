/**
 * 推荐白名单管理 API（仅管理员）
 * GET  /api/admin/recommend?page=1&limit=50    列出已推荐歌曲（分页）
 * POST /api/admin/recommend { uids: string[] } 批量加入推荐
 *
 * uid 为 `source-{存储songmid}` 复合格式，与 /api/search 返回的 uid 一致。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { listRecommendedMusicInfo, setRecommendedBatch } from '@/lib/db'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const sp = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const limit = Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50)
    const keyword = sp.get('keyword') || undefined
    const validSortBy = ['updatedAt', 'name', 'singer'] as const
    const sortByParam = sp.get('sortBy')
    const sortBy =
      sortByParam && (validSortBy as readonly string[]).includes(sortByParam)
        ? (sortByParam as (typeof validSortBy)[number])
        : undefined
    const sortOrderParam = sp.get('sortOrder')
    const sortOrder = sortOrderParam === 'asc' || sortOrderParam === 'desc' ? sortOrderParam : undefined
    const result = await listRecommendedMusicInfo(page, limit, { keyword, sortBy, sortOrder })
    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取推荐列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const uids = Array.isArray(body?.uids)
      ? body.uids.filter((u: unknown) => typeof u === 'string')
      : []

    if (uids.length === 0) {
      return createErrorResponse('INVALID_PARAMS', '缺少必填字段: uids (非空数组)', 400)
    }

    const result = await setRecommendedBatch(uids, true)
    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '加入推荐失败', 500)
  }
}
