/**
 * 推荐白名单清空 API（仅管理员）
 * POST /api/admin/recommend/clear-all  一键清空全部推荐（isRecommended 全置 false）
 *
 * 一条 SQL updateMany，不先查 uid 列表。返回取消的条数。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { clearAllRecommended } from '@/lib/db'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const result = await clearAllRecommended()
    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend/clear-all POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '清空推荐失败', 500)
  }
}
