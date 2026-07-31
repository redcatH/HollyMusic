/**
 * 歌词 API
 * GET /api/lyrics?id={songId}
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import * as dbAPI from '@/lib/db'
import { fetchLyricForMusic } from '@/lib/services/lyrics'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: id', 400)
    }

    const musicInfo = await dbAPI.resolveMusicInfoById(id)
    if (!musicInfo) {
      return createSuccessResponse({ songId: id, lyric: null, tlyric: null, hasLyric: false })
    }

    const lyric = await fetchLyricForMusic(musicInfo)
    return createSuccessResponse({
      songId: id,
      lyric: lyric?.lyric ?? null,
      tlyric: lyric?.tlyric ?? null,
      hasLyric: !!lyric?.lyric,
    })
  } catch (err) {
    logger.error('[api/lyrics] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取歌词失败', 500)
  }
}
