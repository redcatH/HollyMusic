import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { getSiteSettings } from '@/lib/services/site-settings'

export async function GET() {
  try {
    const response = createSuccessResponse(await getSiteSettings())
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    logger.error('[site/settings] 读取站点设置失败:', error)
    return createErrorResponse('UNAVAILABLE', '暂时无法获取站点设置', 503)
  }
}
