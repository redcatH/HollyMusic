import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { isCapability, isPlatformId } from '@/lib/platform-plugins'
import { PluginError, safeId } from '@/lib/server/platform-plugin-contract'
import { getPluginPage, persistPluginSongs } from '@/lib/services/platform-catalog'
import { AuthError, requireUser } from '@/lib/services/user-context'
import type { MusicInfo } from '@/lib/types/music'

export async function GET(request: NextRequest) {
  try {
    await requireUser(request)
    const query = request.nextUrl.searchParams
    const source = query.get('source')
    const capability = query.get('capability')
    const limit = Number(query.get('limit') ?? 30)
    const page = Number(query.get('page') ?? 1)
    const id = query.get('id') || undefined
    const categoryId = query.get('categoryId') || undefined
    const keyword = query.get('keyword')?.trim() || undefined
    const continuation = query.get('cursor') || undefined
    if (!isPlatformId(source) || !isCapability(capability) || !Number.isInteger(limit) || limit < 1 || limit > 100
      || (id !== undefined && !safeId(id)) || (categoryId !== undefined && !safeId(categoryId))
      || !Number.isSafeInteger(page) || page < 1 || page > 1000
      || (continuation?.length ?? 0) > 256 || (keyword?.length ?? 0) > 200) throw new PluginError('平台或查询参数无效')
    if ((capability === 'getPlaylist' || capability === 'getChart' || capability === 'getRadioTracks') && !id) throw new PluginError('缺少集合 ID')
    if ((capability === 'searchPlaylists' || capability === 'searchSongs') && !keyword) throw new PluginError('缺少搜索关键词')
    const result = await getPluginPage(source, capability, { id, categoryId, keyword, limit }, page, undefined, continuation, query.get('refresh') === '1')
    if (!result) throw new PluginError('此平台功能暂未启用', 404)
    const songs = capability === 'searchSongs' || capability === 'getPlaylist' || capability === 'getChart' || capability === 'getRadioTracks'
    const items = songs ? await persistPluginSongs(result.items as MusicInfo[]) : result.items
    return createSuccessResponse({ items, collection: result.collection, total: result.total, hasMore: result.hasMore, nextCursor: result.continuation })
  } catch (error) {
    if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
    if (error instanceof PluginError) return createErrorResponse('PLATFORM_CATALOG_ERROR', error.message, error.status)
    return createErrorResponse('PLATFORM_CATALOG_FAILED', '读取平台内容失败', 500)
  }
}
