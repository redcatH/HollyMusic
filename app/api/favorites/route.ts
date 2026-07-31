/**
 * 收藏 API
 * GET    /api/favorites?limit=&offset=   收藏列表
 * POST   /api/favorites  body {id}       收藏
 * DELETE /api/favorites?id=              取消收藏
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { listFavoriteSongs, starSong, unstarSong } from '@/lib/services/favorites-service'
import { logger } from '@/lib/logger'

function authGuard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  return null
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '200')
    const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0')
    const data = await listFavoriteSongs(user.id, { limit, offset })
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/favorites GET] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取收藏失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const body = await request.json().catch(() => ({}))
    const id = body?.id
    if (!id) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: id', 400)
    const data = await starSong(user.id, String(id))
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/favorites POST] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '收藏失败', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: id', 400)
    const data = await unstarSong(user.id, id)
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/favorites DELETE] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '取消收藏失败', 500)
  }
}
