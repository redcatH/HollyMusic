/**
 * 歌单 API
 * GET   /api/playlists        歌单列表
 * POST  /api/playlists {name} 创建歌单
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { listPlaylistsForUser, createPlaylist } from '@/lib/services/playlist-service'
import { logger } from '@/lib/logger'

function authGuard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  return null
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const list = await listPlaylistsForUser(user.username)
    return createSuccessResponse({ list })
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/playlists GET] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取歌单失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: name', 400)
    const playlist = await createPlaylist(user.username, name)
    return createSuccessResponse(playlist, 201)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/playlists POST] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '创建歌单失败', 500)
  }
}
