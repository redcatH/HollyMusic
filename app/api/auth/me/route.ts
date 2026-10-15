/**
 * 当前会话查询 API
 * GET /api/auth/me  → { authenticated, username?, mustChangePassword? }
 */

import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { getAuthState } from '@/lib/services/user-context'
import { getInitializationStatus } from '@/lib/services/initialization'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const initialization = await getInitializationStatus()
    const state = await getAuthState(request)
    const response = createSuccessResponse({
      authenticated: state.authenticated,
      username: state.user?.username ?? null,
      mustChangePassword: state.authenticated ? state.mustChangePassword : false,
      ...initialization,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    logger.error('[auth/me] 无法读取实例状态:', error)
    const response = createErrorResponse('UNAVAILABLE', '暂时无法连接服务，请稍后重试', 503)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
}
