/**
 * 随机歌曲 API
 * GET /api/random?size=30  → 从已入库曲目随机抽取
 *
 * 需登录（requireUser），未登录返回 401。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { getRandomMusicInfoList, getStorageSongmidForMusicInfo } from '@/lib/db'
import { getSearchSources } from '@/lib/search-config'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { logger } from '@/lib/logger'
import type { Song } from '@/lib/types/music'

export async function GET(request: NextRequest) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const size = parseInt(request.nextUrl.searchParams.get('size') || '30')
    const safeSize = Math.max(1, Math.min(size, 100))
    const sources = getSearchSources()
    const list = await getRandomMusicInfoList(safeSize, sources)
    const withId: Song[] = list.map(mi => ({
      ...mi,
      uid: `${mi.source}-${getStorageSongmidForMusicInfo(mi)}`,
    }))
    return createSuccessResponse({ list: withId, size: withId.length })
  } catch (err) {
    if (err instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', err.message, 401)
    }
    logger.error('[api/random] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取随机歌曲失败', 500)
  }
}
