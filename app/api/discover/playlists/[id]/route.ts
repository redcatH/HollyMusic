import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { getRecommendedPlaylistDetail, isDiscoverySource } from '@/lib/services/discovery-service'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const source = new URL(_request.url).searchParams.get('source') || 'tx'
    if (!isDiscoverySource(source)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '不支持的渠道', 400)
    const detail = await getRecommendedPlaylistDetail(source, id)
    if (!detail) return createErrorResponse(ErrorCodes.CONFIG_NOT_FOUND, '推荐歌单不存在', 404)
    return createSuccessResponse(detail)
  } catch (error) {
    logger.error('[api/discover/playlists/[id]] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取推荐歌单详情失败', 500)
  }
}
