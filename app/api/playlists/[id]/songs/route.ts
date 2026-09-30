/**
 * 歌单歌曲 API
 * POST   /api/playlists/[id]/songs  body {songIds[]}        添加歌曲
 * DELETE /api/playlists/[id]/songs  query {entryId} 移除歌曲（按 PlaylistEntry.id）
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import {
  addSongsToPlaylist,
  removeSongsFromPlaylist,
  PlaylistError,
} from '@/lib/services/playlist-service'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(request)
    const { id } = await params
    const playlistId = parseInt(id, 10)
    if (isNaN(playlistId)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '无效的歌单 id', 400)
    const body = await request.json().catch(() => ({}))
    const songIds = Array.isArray(body?.songIds) ? body.songIds.map(String) : []
    if (songIds.length === 0) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少 songIds', 400)
    await addSongsToPlaylist(playlistId, user.username, songIds)
    return createSuccessResponse({ added: true })
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    if (err instanceof PlaylistError) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, err.message, err.statusCode)
    }
    logger.error('[api/playlists/[id]/songs POST] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '添加歌曲失败', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(request)
    const { id } = await params
    const playlistId = parseInt(id, 10)
    if (isNaN(playlistId)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '无效的歌单 id', 400)

    const entryIdParam = request.nextUrl.searchParams.get('entryId')
    const entryId = Number(entryIdParam)
    if (!entryIdParam || !Number.isSafeInteger(entryId) || entryId <= 0) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '无效的 entryId', 400)
    }
    await removeSongsFromPlaylist(playlistId, user.username, [entryId])
    return createSuccessResponse({ removed: true })
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    if (err instanceof PlaylistError) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, err.message, err.statusCode)
    }
    logger.error('[api/playlists/[id]/songs DELETE] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '移除歌曲失败', 500)
  }
}
