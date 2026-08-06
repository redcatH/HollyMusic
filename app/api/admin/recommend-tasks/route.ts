/**
 * 推荐任务管理 API（仅管理员）
 * GET  /api/admin/recommend-tasks?page=1&limit=50&status=queued  任务列表
 * POST /api/admin/recommend-tasks { name, artists, config, apiKey }  创建任务并入队
 *
 * apiKey 不落 DB，只在服务端内存里持有（跑完即弃）。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { listTasks, createTask } from '@/lib/services/recommend-worker'
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
    const status = sp.get('status') || undefined
    const result = await listTasks(page, limit, status)
    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend-tasks GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取任务列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name : ''
    const artists = Array.isArray(body?.artists) ? body.artists.filter((a: unknown) => typeof a === 'string') : []
    const config = body?.config && typeof body.config === 'object' ? body.config : {}
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''

    if (artists.length === 0) {
      return createErrorResponse('INVALID_PARAMS', '歌手列表不能为空（每行一个歌手）', 400)
    }

    const task = await createTask({ name, artists, config, apiKey, createdBy: user.username })
    return createSuccessResponse(task, 201)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend-tasks POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '创建任务失败', 500)
  }
}
