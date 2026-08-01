/**
 * 音源配置单条操作 API（仅管理员）
 * PUT    /api/admin/sources/[id]   修改音源 { name?, description?, priority?, timeout?, enabled?, pt? }
 * DELETE /api/admin/sources/[id]   删除音源 + 关联脚本
 *
 * id 用脚本路径（URL-encoded）做唯一标识
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { removeSource, updateSource } from '@/lib/services/source-manager-service'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  if (err instanceof Error && err.message.includes('找不到')) {
    return createErrorResponse('NOT_FOUND', err.message, 404)
  }
  return null
}

/** 从 URL 参数解析出脚本路径（catch-all 风格也兼容，这里用单段） */
async function parsePath(props: { params: Promise<{ id: string }> }): Promise<string> {
  const params = await props.params
  // id 是 URL-encoded 的脚本相对路径，如 custom-sources%2Fxxx.js
  // 注意：可能因路径含 / 被分段，但单段 [id] 不含 /，故脚本必须放在 custom-sources/ 一级目录
  // 若路径含 /，需要用 [...id] catch-all。当前约定都在 custom-sources/ 下，文件名不含 /，单段足够
  return decodeURIComponent(params.id)
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
    const sourcePath = await parsePath(props)

    const body = await request.json().catch(() => ({}))
    const updated = await updateSource(sourcePath, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      timeout: typeof body.timeout === 'number' ? body.timeout : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      pt: Array.isArray(body.pt) ? body.pt : undefined,
    })

    return createSuccessResponse(updated)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/sources/[id] PUT] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '更新音源失败', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
    const sourcePath = await parsePath(props)

    await removeSource(sourcePath)
    return createSuccessResponse({ ok: true })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/sources/[id] DELETE] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '删除音源失败', 500)
  }
}
