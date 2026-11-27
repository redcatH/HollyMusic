import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import type { FavoritePlaylistInput } from '@/lib/api/favorite-playlists'
import { logger } from '@/lib/logger'
import { isDiscoverySource } from '@/lib/services/discovery-service'
import { BUILTIN_PLATFORM_IDS } from '@/lib/platform-plugins'
import { getPluginBinding } from '@/lib/services/platform-catalog'
import { listFavoritePlaylists, removeFavoritePlaylist, saveFavoritePlaylist } from '@/lib/services/favorite-playlist-service'
import { AuthError, requireUser } from '@/lib/services/user-context'

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}

function parsePlaylist(value: unknown): FavoritePlaylistInput | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const { source, playlistId, name, cover, author, songCount } = data
  if (typeof source !== 'string' || !isDiscoverySource(source) || !validId(playlistId)) return null
  if (typeof name !== 'string' || !name.trim() || name.length > 500) return null
  if (typeof author !== 'string' || author.length > 500) return null
  if (typeof cover !== 'string' || cover.length > 4096) return null
  if (cover) {
    try { if (!['https:', 'http:'].includes(new URL(cover).protocol)) return null } catch { return null }
  }
  if (typeof songCount !== 'number' || !Number.isSafeInteger(songCount) || songCount < 0 || songCount > 1_000_000) return null
  return { source, playlistId: playlistId.trim(), name: name.trim(), cover, author, songCount }
}

function handleError(error: unknown) {
  if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
  logger.error('[api/playlists/favorites] error:', error)
  return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '歌单收藏操作失败，请重试', 500)
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request)
    return createSuccessResponse(await listFavoritePlaylists(user.id))
  } catch (error) { return handleError(error) }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const playlist = parsePlaylist(await request.json().catch(() => null))
    if (!playlist || (!(BUILTIN_PLATFORM_IDS as readonly string[]).includes(playlist.source)
      && !await getPluginBinding(playlist.source, 'getPlaylist').catch(() => null))) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '歌单收藏参数无效', 400)
    }
    return createSuccessResponse(await saveFavoritePlaylist(user.id, playlist))
  } catch (error) { return handleError(error) }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const { searchParams } = request.nextUrl
    const source = searchParams.get('source')
    const playlistId = searchParams.get('playlistId')
    if (!isDiscoverySource(source) || !validId(playlistId)) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少有效的平台或歌单 ID', 400)
    }
    return createSuccessResponse(await removeFavoritePlaylist(user.id, source, playlistId.trim()))
  } catch (error) { return handleError(error) }
}
