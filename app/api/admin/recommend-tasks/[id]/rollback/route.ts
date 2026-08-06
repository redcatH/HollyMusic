/**
 * 推荐任务回滚 API（仅管理员）
 * POST /api/admin/recommend-tasks/[id]/rollback
 *
 * 把该任务实际加入推荐白名单的歌曲撤销为不推荐（依据 progress.results[].addedUids）。
 * 任务 status 不变，仅在 progress 标记 rolledBackAt。旧版本任务无 addedUids 则无法回滚。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { rollbackTask } from '@/lib/services/recommend-worker'
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
    const { task, removed } = await rollbackTask(id)
    if (!task) return createErrorResponse('NOT_FOUND', '任务不存在', 404)
    return createSuccessResponse({ task, removed })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    // 业务校验错误（未完成 / 已回滚 / 旧任务无记录）→ 400
    if (err instanceof Error) {
      return createErrorResponse('INVALID_PARAMS', err.message, 400)
    }
    logger.error('[api/admin/recommend-tasks/[id]/rollback] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '回滚失败', 500)
  }
}
