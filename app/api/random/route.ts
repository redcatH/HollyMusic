/**
 * 随机歌曲 API
 * GET /api/random?size=30  → 从已入库曲目随机抽取
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { getRandomMusicInfoList, getStorageSongmidForMusicInfo } from '@/lib/db'
import { getSearchSources } from '@/lib/search-config'
import { logger } from '@/lib/logger'
import type { Song } from '@/lib/types/music'

export async function GET(request: NextRequest) {
  try {
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
    logger.error('[api/random] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取随机歌曲失败', 500)
  }
}
