/**
 * 在线洛雪音源订阅 API（仅管理员）
 * POST /api/admin/sources/subscriptions  { url }
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { importSubscription, SourceSubscriptionError } from '@/lib/services/source-manager-service'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return createErrorResponse('INVALID_PARAMS', '缺少必填字段: url', 400)

    const source = await importSubscription(url)
    return createSuccessResponse(source, 201)
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
    if (err instanceof SourceSubscriptionError) {
      return createErrorResponse('SUBSCRIPTION_ERROR', err.message, err.status)
    }
    logger.error('[api/admin/sources/subscriptions POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '导入订阅失败', 500)
  }
}
