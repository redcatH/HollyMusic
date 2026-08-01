/**
 * 音源配置管理 API（仅管理员）
 * GET  /api/admin/sources      列出音源配置 + 脚本状态
 * POST /api/admin/sources      新增音源配置 { path, name?, description?, priority?, timeout?, enabled?, pt? }
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { addSource, listSourcesWithStatus } from '@/lib/services/source-manager-service'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  if (err instanceof Error && err.message.includes('已存在')) {
    return createErrorResponse('CONFLICT', err.message, 409)
  }
  return null
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const list = await listSourcesWithStatus()
    return createSuccessResponse({ list })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/sources GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取音源列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))

    const path = typeof body?.path === 'string' ? body.path.trim() : ''
    if (!path) {
      return createErrorResponse('INVALID_PARAMS', '缺少必填字段: path', 400)
    }

    const created = await addSource({
      path,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      timeout: typeof body.timeout === 'number' ? body.timeout : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      pt: Array.isArray(body.pt) ? body.pt : undefined,
    })

    return createSuccessResponse(created, 201)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/sources POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '新增音源失败', 500)
  }
}
