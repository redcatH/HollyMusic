/**
 * 推荐任务重跑 API（仅管理员）
 * POST /api/admin/recommend-tasks/[id]/rerun { apiKey, config? }  重置为 queued 并重新入队
 *
 * artists 不变（重跑同一批歌手）。config 可选：提供则覆盖原配置（改提示词/URL/模型/音源等），
 * 不提供则完全复用原 config。apiKey 需重新传（不持久化）。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { rerunTask } from '@/lib/services/recommend-worker'
import { resolveAICreds } from '@/lib/services/ai-helper'
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
    const body = await request.json().catch(() => ({}))
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const config = body?.config && typeof body.config === 'object' ? body.config : undefined
    // 安全不变式：本次覆盖配置里的自定义 openaiBaseUrl 必须搭配用户自己的 API key。
    // 不传 config 复用原 config 的场景由 worker 运行时兜底（无用户 key 强制回落 env 地址）
    if (
      config &&
      typeof config.openaiBaseUrl === 'string' &&
      !resolveAICreds(apiKey, config.openaiBaseUrl)
    ) {
      return createErrorResponse(
        'INVALID_PARAMS',
        '使用自定义 AI baseUrl 时必须同时填写你自己的 API key（服务端密钥不允许发往自定义地址），或清空 baseUrl 使用服务端配置',
        400,
      )
    }
    const task = await rerunTask(id, apiKey, config)
    if (!task) return createErrorResponse('NOT_FOUND', '任务不存在', 404)
    return createSuccessResponse(task)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    if (err instanceof Error && err.message.includes('正在执行')) {
      return createErrorResponse('INVALID_PARAMS', err.message, 400)
    }
    logger.error('[api/admin/recommend-tasks/[id]/rerun] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '重跑失败', 500)
  }
}
