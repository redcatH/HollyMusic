/**
 * 单个用户管理 API（仅管理员）
 * GET    /api/admin/users/[id]   获取
 * PUT    /api/admin/users/[id]   更新 { username?, password? }
 * DELETE /api/admin/users/[id]   删除
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import {
  getUserById,
  updateUser,
  deleteUser,
  UserInputError,
  NotFoundError,
} from '@/lib/services/user-service'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  if (err instanceof NotFoundError) return createErrorResponse('NOT_FOUND', err.message, 404)
  if (err instanceof UserInputError) return createErrorResponse('INVALID_PARAMS', err.message, 400)
  return null
}

function parseId(idStr: string | undefined): number | null {
  const id = Number(idStr)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
    const { id: idStr } = await props.params
    const id = parseId(idStr)
    if (id == null) return createErrorResponse('INVALID_PARAMS', '无效的用户 id', 400)
    const user = await getUserById(id)
    if (!user) return createErrorResponse('NOT_FOUND', '用户不存在', 404)
    return createSuccessResponse(user)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/users/[id] GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取用户失败', 500)
  }
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
    const { id: idStr } = await props.params
    const id = parseId(idStr)
    if (id == null) return createErrorResponse('INVALID_PARAMS', '无效的用户 id', 400)
    const body = await request.json().catch(() => ({}))
    const username = typeof body?.username === 'string' ? body.username : undefined
    const password = typeof body?.password === 'string' ? body.password : undefined
    const user = await updateUser(id, { username, password })
    return createSuccessResponse(user)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/users/[id] PUT] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '更新用户失败', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin(request)
    const { id: idStr } = await props.params
    const id = parseId(idStr)
    if (id == null) return createErrorResponse('INVALID_PARAMS', '无效的用户 id', 400)
    await deleteUser(id, me.username)
    return createSuccessResponse({ ok: true })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/users/[id] DELETE] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '删除用户失败', 500)
  }
}
