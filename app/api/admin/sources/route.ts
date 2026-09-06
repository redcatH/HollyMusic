/**
 * 音源配置管理 API（仅管理员）
 * GET   /api/admin/sources      列出音源配置 + 脚本状态
 * POST  /api/admin/sources      新增音源配置 { path, name?, description?, priority?, timeout?, enabled?, pt? }
 * PATCH /api/admin/sources      批量更新 { updates: [{ path, enabled?, pt? }] }（一次写入 + 一次 reload）
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { addSource, listSourcesWithStatus, updateSourcesBulk } from '@/lib/services/source-manager-service'
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

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))

    const updates = Array.isArray(body?.updates) ? body.updates : []
    if (
      updates.length === 0 ||
      updates.length > 200 ||
      !updates.every(
        (u: { path?: unknown; enabled?: unknown; pt?: unknown; priority?: unknown }) =>
          typeof u?.path === 'string' &&
          u.path.trim().length > 0 &&
          (u.enabled === undefined || typeof u.enabled === 'boolean') &&
          (u.pt === undefined || (Array.isArray(u.pt) && u.pt.every(p => typeof p === 'string'))) &&
          (u.priority === undefined || (typeof u.priority === 'number' && Number.isFinite(u.priority))) &&
          (u.enabled !== undefined || u.pt !== undefined || u.priority !== undefined)
      )
    ) {
      return createErrorResponse(
        'INVALID_PARAMS',
        '无效的 updates：需为非空数组，每项含 path 且带 enabled 和/或 pt 字段',
        400
      )
    }

    const result = await updateSourcesBulk(
      updates.map((u: { path: string; enabled?: boolean; pt?: string[]; priority?: number }) => ({
        path: u.path,
        enabled: u.enabled,
        pt: u.pt,
        priority: u.priority,
      }))
    )
    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/sources PATCH] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '批量更新音源失败', 500)
  }
}
