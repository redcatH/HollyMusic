import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { addSongsToPlaylist, createPlaylist, getPlaylistDetail, PlaylistError } from '@/lib/services/playlist-service'
import { getTxPlaylistDetail, getWySongsByIds } from '@/lib/services/discovery-service'
import { upsertMusicInfosInTransaction } from '@/lib/db'
import { assertCsvSize, mergeImportedSong, parseNeteaseCsv, parseQqPlaylistInput } from '@/lib/services/playlist-import'
import { logger } from '@/lib/logger'
import type { Song } from '@/lib/types/music'

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const form = await request.formData()
    const source = String(form.get('source') || 'wy-csv')
    const file = form.get('file')
    const requestedName = String(form.get('name') || '').trim()
    const mode = String(form.get('mode') || 'create')
    const requestedPlaylistId = Number(form.get('playlistId'))

    let sourceIds: string[] = []
    let sourceName = ''
    let duplicateCount = 0
    let fallbackCount = 0

    if (source === 'tx') {
      const detail = await getTxPlaylistDetail(parseQqPlaylistInput(String(form.get('input') || '')))
      if (!detail) return createErrorResponse(ErrorCodes.INVALID_PARAMS, 'QQ 音乐歌单为空或不存在', 400)
      sourceIds = detail.tracks.map(song => `${song.source}-${song.songmid}`)
      sourceName = detail.name
    } else if (source === 'wy-csv') {
      if (!(file instanceof File)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '请选择 CSV 文件', 400)
      if (!file.name.toLowerCase().endsWith('.csv')) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '只支持 CSV 文件', 400)
      assertCsvSize(file.size)
      const parsed = parseNeteaseCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()))
      sourceName = file.name.replace(/\.csv$/i, '')
      const fetched = await getWySongsByIds(parsed.rows.map(row => row.songId)).catch(error => {
        logger.warn('[api/playlists/import] 网易云详情补全失败', error)
        return [] as Song[]
      })
      const fetchedById = new Map(fetched.map(song => [String(song.songId || song.songmid), song]))
      const songs = parsed.rows.map(row => mergeImportedSong(row, fetchedById.get(row.songId)))
      sourceIds = songs.map(song => `wy-${song.songmid}`)
      duplicateCount = parsed.duplicateCount
      fallbackCount = songs.filter(song => song.importQualityFallback).length
      await upsertMusicInfosInTransaction(songs)
    } else {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '不支持的导入来源', 400)
    }

    let playlistId: number
    if (mode === 'append') {
      if (!Number.isSafeInteger(requestedPlaylistId) || requestedPlaylistId <= 0) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '追加模式需要有效的歌单 ID', 400)
      playlistId = requestedPlaylistId
    } else {
      const playlist = await createPlaylist(user.username, requestedName || sourceName || '导入歌单')
      playlistId = playlist.id
    }

    const before = await getPlaylistDetail(playlistId, user.username)
    const existingIds = new Set((before?.entries || []).map(entry => entry.songId))
    const existingCount = sourceIds.filter(songId => existingIds.has(songId)).length
    await addSongsToPlaylist(playlistId, user.username, sourceIds)
    const detail = await getPlaylistDetail(playlistId, user.username)
    return createSuccessResponse({
      playlistId,
      source,
      totalRows: sourceIds.length,
      added: Math.max(0, sourceIds.length - existingCount),
      duplicates: duplicateCount + existingCount,
      qualityFallback: fallbackCount,
      songCount: detail?.songCount || 0,
    }, 201)
  } catch (error) {
    if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
    if (error instanceof PlaylistError) return createErrorResponse(ErrorCodes.INVALID_PARAMS, error.message, error.statusCode)
    if (error instanceof Error && /CSV|文件|网易云|QQ/.test(error.message)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, error.message, 400)
    logger.error('[api/playlists/import] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '导入歌单失败', 500)
  }
}
