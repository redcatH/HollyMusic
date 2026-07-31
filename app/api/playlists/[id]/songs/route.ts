/**
 * 歌单歌曲 API
 * POST   /api/playlists/[id]/songs  body {songIds[]}        添加歌曲
 * DELETE /api/playlists/[id]/songs  query/body {positions[]} 移除歌曲（按 position）
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

    // positions 可来自 query 或 body
    let positions: number[]
    const posQuery = request.nextUrl.searchParams.get('positions')
    if (posQuery) {
      positions = posQuery
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n))
    } else {
      const body = await request.json().catch(() => ({}))
      positions = Array.isArray(body?.positions)
        ? body.positions.map((n: unknown) => Number(n)).filter((n: number) => !isNaN(n))
        : []
    }
    if (positions.length === 0) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少 positions', 400)
    }
    await removeSongsFromPlaylist(playlistId, user.username, positions)
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
