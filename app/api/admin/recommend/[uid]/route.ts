/**
 * 推荐白名单单条操作 API（仅管理员）
 * DELETE /api/admin/recommend/[uid]   取消推荐（isRecommended 置 false）
 *
 * uid 为 `source-{存储songmid}` 复合格式。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { setRecommendedStatus } from '@/lib/db'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ uid: string }> },
) {
  try {
    await requireAdmin(request)
    const params = await props.params
    const uid = decodeURIComponent(params.uid)
    const result = await setRecommendedStatus(uid, false)
    if (result.updated === 0) {
      return createErrorResponse('NOT_FOUND', '歌曲不存在或未在推荐列表中', 404)
    }
    return createSuccessResponse({ ok: true })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend/[uid] DELETE] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '取消推荐失败', 500)
  }
}
