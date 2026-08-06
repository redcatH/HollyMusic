/**
 * 推荐任务单条操作 API（仅管理员）
 * GET    /api/admin/recommend-tasks/[id]  任务详情（含 progress）
 * DELETE /api/admin/recommend-tasks/[id]  删除任务
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { getTask, deleteTask } from '@/lib/services/recommend-worker'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request)
    const { id } = await props.params
    const task = await getTask(id)
    if (!task) return createErrorResponse('NOT_FOUND', '任务不存在', 404)
    return createSuccessResponse(task)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend-tasks/[id] GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取任务失败', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request)
    const { id } = await props.params
    await deleteTask(id)
    return createSuccessResponse({ ok: true })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend-tasks/[id] DELETE] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '删除任务失败', 500)
  }
}
