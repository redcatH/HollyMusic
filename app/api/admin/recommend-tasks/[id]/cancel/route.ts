/**
 * 推荐任务取消 API（仅管理员）
 * POST /api/admin/recommend-tasks/[id]/cancel  取消任务
 *
 * queued 直接置 cancelled；running 设取消标志，worker 在当前歌手跑完后停止。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { cancelTask } from '@/lib/services/recommend-worker'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request)
    const { id } = await props.params
    const task = await cancelTask(id)
    if (!task) return createErrorResponse('NOT_FOUND', '任务不存在', 404)
    return createSuccessResponse(task)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend-tasks/[id]/cancel] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '取消失败', 500)
  }
}
