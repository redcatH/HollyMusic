import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { getToplists, isDiscoverySource } from '@/lib/services/discovery-service'

export async function GET(request: Request) {
  try {
    const source = new URL(request.url).searchParams.get('source')
    if (source && !isDiscoverySource(source)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '不支持的渠道', 400)
    return createSuccessResponse(await getToplists(isDiscoverySource(source) ? source : 'tx'))
  } catch (error) {
    logger.error('[api/discover/toplists] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取排行榜失败', 500)
  }
}
