import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { getRecommendedPlaylists, isDiscoverySource } from '@/lib/services/discovery-service'

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') || 12)
    const page = Number(request.nextUrl.searchParams.get('page') || 1)
    const source = request.nextUrl.searchParams.get('source') || 'tx'
    if (!isDiscoverySource(source)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '不支持的渠道', 400)
    return createSuccessResponse(await getRecommendedPlaylists(
      source,
      Number.isFinite(limit) ? limit : 12,
      Number.isFinite(page) ? page : 1,
      {
        tag: request.nextUrl.searchParams.get('tag') || undefined,
        sort: ['recommend', 'hot', 'new', 'collect', 'soar'].includes(request.nextUrl.searchParams.get('sort') || '')
          ? request.nextUrl.searchParams.get('sort') as 'recommend' | 'hot' | 'new' | 'collect' | 'soar'
          : 'recommend',
        keyword: request.nextUrl.searchParams.get('keyword') || undefined,
      },
    ))
  } catch (error) {
    logger.error('[api/discover/playlists] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取推荐歌单失败', 500)
  }
}
