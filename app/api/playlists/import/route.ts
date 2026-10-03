import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { addSongsToPlaylist, createPlaylist, getPlaylistDetail, PlaylistError } from '@/lib/services/playlist-service'
import { getWySongsByIds } from '@/lib/services/discovery-service'
import { upsertMusicInfosInTransaction } from '@/lib/db'
import { assertCsvSize, mergeImportedSong, parseNeteaseCsv } from '@/lib/services/playlist-import'
import { logger } from '@/lib/logger'
import type { Song } from '@/lib/types/music'

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '请选择 CSV 文件', 400)
    if (!file.name.toLowerCase().endsWith('.csv')) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '只支持 CSV 文件', 400)
    assertCsvSize(file.size)
    const parsed = parseNeteaseCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()))
    const requestedName = String(form.get('name') || '').trim()
    const mode = String(form.get('mode') || 'create')
    const requestedPlaylistId = Number(form.get('playlistId'))

    let playlistId: number
    if (mode === 'append') {
      if (!Number.isSafeInteger(requestedPlaylistId) || requestedPlaylistId <= 0) {
        return createErrorResponse(ErrorCodes.INVALID_PARAMS, '追加模式需要有效的歌单 ID', 400)
      }
      playlistId = requestedPlaylistId
    } else {
      const playlist = await createPlaylist(user.username, requestedName || file.name.replace(/\.csv$/i, ''))
      playlistId = playlist.id
    }

    const ids = parsed.rows.map(row => row.songId)
    let fetched: Song[] = []
    try {
      fetched = await getWySongsByIds(ids)
    } catch (error) {
      logger.warn('[api/playlists/import] 网易云详情补全失败，使用 CSV 元数据和 128k 兜底', error)
    }
    const fetchedById = new Map(fetched.map(song => [String(song.songId || song.songmid), song]))
    const songs = parsed.rows.map(row => mergeImportedSong(row, fetchedById.get(row.songId)))
    const fallbackCount = songs.filter(song => song.importQualityFallback).length
    await upsertMusicInfosInTransaction(songs)

    const before = await getPlaylistDetail(playlistId, user.username)
    const existingIds = new Set((before?.entries || []).map(entry => entry.songId))
    const songIds = songs.map(song => `wy-${song.songmid}`)
    const existingCount = songIds.filter(songId => existingIds.has(songId)).length
    await addSongsToPlaylist(playlistId, user.username, songIds)
    const detail = await getPlaylistDetail(playlistId, user.username)
    return createSuccessResponse({
      playlistId,
      totalRows: parsed.rows.length,
      added: Math.max(0, songIds.length - existingCount),
      duplicates: parsed.duplicateCount + existingCount,
      qualityFallback: fallbackCount,
      songCount: detail?.songCount || 0,
    }, 201)
  } catch (error) {
    if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
    if (error instanceof PlaylistError) return createErrorResponse(ErrorCodes.INVALID_PARAMS, error.message, error.statusCode)
    if (error instanceof Error && /CSV|文件|网易云/.test(error.message)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, error.message, 400)
    logger.error('[api/playlists/import] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '导入歌单失败', 500)
  }
}
