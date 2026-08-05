/**
 * 推荐白名单批量取消 API（仅管理员）
 * POST /api/admin/recommend/batch-remove { uids: string[] }  批量取消推荐（isRecommended 置 false）
 *
 * 用 POST + body 传 uids，避免 DELETE 带 body 被代理剥离、也避免 uids 多时 URL 过长。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { setRecommendedBatch } from '@/lib/db'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
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

    const result = await setRecommendedBatch(uids, false)
    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend/batch-remove POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '批量取消推荐失败', 500)
  }
}
