/**
 * 音源配置单条操作 API（仅管理员）
 * POST   /api/admin/sources/[id]   手动更新在线订阅脚本
 * PUT    /api/admin/sources/[id]   修改音源配置（包括 subscriptionUrl）
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
import {
  removeSource,
  updateSource,
  SourceConfigError,
} from '@/lib/services/source-manager-service'
import { logger } from '@/lib/logger'
import { createDraft } from '@/lib/services/source-test-service'
import { assertTestOrigin, testRouteError } from '@/lib/server/source-test-route'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  if (err instanceof SourceConfigError) return createErrorResponse('INVALID_PARAMS', err.message, err.statusCode)
  if (err instanceof Error && err.message.includes('找不到')) {
    return createErrorResponse('NOT_FOUND', err.message, 404)
  }
  return null
}

/** Next 已解码动态路由参数，保留文件名中的字面百分号。 */
async function parsePath(props: { params: Promise<{ id: string }> }): Promise<string> {
  const params = await props.params
  return params.id
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
    assertTestOrigin(request)
    const sourcePath = await parsePath(props)

    const body = await request.json().catch(() => ({}))
    if (body.subscriptionUrl !== undefined && typeof body.subscriptionUrl !== 'string') {
      return createErrorResponse('INVALID_PARAMS', '订阅地址必须为字符串', 400)
    }
    const updated = await updateSource(sourcePath, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      timeout: typeof body.timeout === 'number' ? body.timeout : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      pt: Array.isArray(body.pt) ? body.pt : undefined,
      subscriptionUrl: body.subscriptionUrl,
    })

    return createSuccessResponse(updated)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/sources/[id] PUT] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '更新音源失败', 500)
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin(request)
    assertTestOrigin(request)
    return createSuccessResponse(await createDraft(user.id, { sourcePath: await parsePath(props), update: true }))
  } catch (error) { return testRouteError(error) }
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
