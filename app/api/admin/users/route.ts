/**
 * 用户管理 API（仅管理员）
 * GET  /api/admin/users      用户列表
 * POST /api/admin/users      新建用户 { username, password }
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { listUsers, createUser, UserInputError } from '@/lib/services/user-service'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  if (err instanceof UserInputError) return createErrorResponse('INVALID_PARAMS', err.message, 400)
  return null
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const list = await listUsers()
    return createSuccessResponse({ list })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/users GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取用户列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const username = typeof body?.username === 'string' ? body.username : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const user = await createUser(username, password)
    return createSuccessResponse(user, 201)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/users POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '创建用户失败', 500)
  }
}
