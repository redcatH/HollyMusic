import manifest from '@/public/manifest.json'
import { createErrorResponse } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'
import { getSiteSettings } from '@/lib/services/site-settings'

export async function GET() {
  try {
    const settings = await getSiteSettings()
    return Response.json({
      ...manifest,
      name: settings.name,
      short_name: settings.name === DEFAULT_SITE_SETTINGS.name ? manifest.short_name : settings.name,
      description: settings.description,
    }, { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' } })
  } catch (error) {
    logger.error('[site/manifest] 读取站点设置失败:', error)
    return createErrorResponse('UNAVAILABLE', '暂时无法获取应用清单', 503)
  }
}
