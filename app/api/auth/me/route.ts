/**
 * 当前会话查询 API
 * GET /api/auth/me  → { authenticated, username? }
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { getAuthState } from '@/lib/services/user-context'

export async function GET(request: NextRequest) {
  const state = await getAuthState(request)
  return createSuccessResponse({
    authenticated: state.authenticated,
    username: state.user?.username ?? null,
  })
}
