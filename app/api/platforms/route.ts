import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { musicSourceManager } from '@/lib/music-source-manager'
import { getPublicPlatforms } from '@/lib/services/platform-catalog'
import { AuthError, requireUser } from '@/lib/services/user-context'

export async function GET(request: NextRequest) {
  try {
    await requireUser(request)
    const items = await getPublicPlatforms()
    const plugins = items.filter(item => item.pluginCapabilities?.length).map(item => item.id)
    const playable = plugins.length ? await musicSourceManager.getPlayablePlatforms(plugins).catch(() => new Set<string>()) : new Set<string>()
    return createSuccessResponse(items.map(item => plugins.includes(item.id) ? { ...item, playable: playable.has(item.id) } : item))
  } catch (error) {
    if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
    return createErrorResponse('PLATFORM_LIST_FAILED', '读取平台列表失败', 500)
  }
}
