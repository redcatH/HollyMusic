import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { getToplistDetail, isDiscoverySource } from '@/lib/services/discovery-service'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const { id } = await params
    const source = new URL(request.url).searchParams.get('source') || 'tx'
    if (!isDiscoverySource(source)) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '不支持的渠道', 400)
    const detail = await getToplistDetail(source, id)
    if (!detail) return createErrorResponse(ErrorCodes.CONFIG_NOT_FOUND, '排行榜不存在', 404)
    return createSuccessResponse(detail)
  } catch (error) {
    if (error instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', error.message, 401)
    }
    logger.error('[api/discover/toplists/[id]] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取排行榜详情失败', 500)
  }
}
