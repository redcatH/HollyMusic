/**
 * 心跳 API（在线状态）
 * POST /api/auth/heartbeat
 *
 * 已登录用户定期上报，更新 lastSeen/lastSeenIp/lastSeenUa，用于在线状态推断。
 * 未登录返回 401；写入 best-effort，失败不影响客户端。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { updateLastSeenByUsername, getClientIp, getUa } from '@/lib/user'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    try {
      await updateLastSeenByUsername(user.username, getClientIp(request), getUa(request))
    } catch (e) {
      logger.warn('[api/auth/heartbeat] update lastSeen failed', e)
    }
    return createSuccessResponse({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', err.message, 401)
    }
    logger.error('[api/auth/heartbeat] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '心跳失败', 500)
  }
}
