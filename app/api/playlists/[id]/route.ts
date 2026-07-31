/**
 * 歌单详情 API
 * GET    /api/playlists/[id]              歌单详情（含歌曲）
 * PATCH  /api/playlists/[id] {name?,comment?,public?}  更新元数据
 * DELETE /api/playlists/[id]              删除歌单
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import {
  getPlaylistDetail,
  updatePlaylistMeta,
  deletePlaylist,
  PlaylistError,
} from '@/lib/services/playlist-service'
import { logger } from '@/lib/logger'

function handleError(err: unknown, action: string) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof PlaylistError) {
    return createErrorResponse(ErrorCodes.INVALID_PARAMS, err.message, err.statusCode)
  }
  logger.error(`[api/playlists/[id]] ${action} error:`, err)
  return createErrorResponse(ErrorCodes.INTERNAL_ERROR, `${action}失败`, 500)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(request)
    const { id } = await params
    const playlistId = parseInt(id, 10)
    if (isNaN(playlistId)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '无效的歌单 id', 400)
    const detail = await getPlaylistDetail(playlistId, user.username)
    if (!detail) return createErrorResponse(ErrorCodes.CONFIG_NOT_FOUND, '歌单不存在或无权访问', 404)
    return createSuccessResponse(detail)
  } catch (err) {
    return handleError(err, '获取歌单')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(request)
    const { id } = await params
    const playlistId = parseInt(id, 10)
    if (isNaN(playlistId)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '无效的歌单 id', 400)
    const body = await request.json().catch(() => ({}))
    const updates: { name?: string; comment?: string; isPublic?: boolean } = {}
    if (body.name !== undefined) updates.name = String(body.name)
    if (body.comment !== undefined) updates.comment = String(body.comment)
    if (body.public !== undefined) updates.isPublic = !!body.public
    await updatePlaylistMeta(playlistId, user.username, updates)
    return createSuccessResponse({ updated: true })
  } catch (err) {
    return handleError(err, '更新歌单')
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
    await deletePlaylist(playlistId, user.username)
    return createSuccessResponse({ deleted: true })
  } catch (err) {
    return handleError(err, '删除歌单')
  }
}
