import { searchCache } from '@/lib/cache-manager'
import { getSearchCacheTTL } from '@/lib/cache-config'
import { getStorageSongmidForMusicInfo, upsertMusicInfosInTransaction } from '@/lib/db'
import { logger } from '@/lib/logger'
import * as musicSearch from '@/lib/music-core/music-search'
import type { SearchResultData } from '@/lib/api/search'
import type { SearchResult, SourceType } from '@/lib/types/music'
import { BUILTIN_PLATFORM_IDS } from '@/lib/platform-plugins'
import { PluginError } from '@/lib/server/platform-plugin-contract'
import { getPluginPage, persistPluginSongs } from './platform-catalog'
import type { MusicInfo } from '@/lib/types/music'

const pendingPages = new Map<string, Promise<SearchResultData>>()

export class SearchStorageError extends Error {}

/** Web 搜索服务：同一页共享上游请求和入库事务，只有成功数据才能缓存。 */
export async function searchSongs(source: SourceType, keyword: string, page: number, requestedLimit: number, continuation?: string): Promise<SearchResultData> {
  const pluginLimit = Math.min(requestedLimit, 30)
  const plugin = await getPluginPage(source, 'searchSongs', { keyword, limit: pluginLimit }, page, undefined, continuation)
  if (plugin) {
    const list = await persistPluginSongs(plugin.items as MusicInfo[])
    return { source, page, limit: pluginLimit, list, total: plugin.total ?? list.length, totalKnown: plugin.total !== undefined,
      allPage: plugin.total === undefined ? page : Math.ceil(plugin.total / pluginLimit), hasMore: plugin.hasMore,
      nextPage: plugin.hasMore ? page + 1 : null, nextCursor: plugin.continuation }
  }
  if (continuation) throw new PluginError('平台内容已变更，请重新搜索', 409)
  if (!(BUILTIN_PLATFORM_IDS as readonly string[]).includes(source)) throw new PluginError('此平台的单曲搜索暂未启用')
  const limit = musicSearch.getSearchPageSize(source, requestedLimit)
  const key = `search:v3:${source}:${encodeURIComponent(keyword)}:${page}:${limit}`
  const cached = searchCache.get(key) as SearchResultData | null
  if (cached) return cached
  const existing = pendingPages.get(key)
  if (existing) return existing

  const pending = (async () => {
    const result: SearchResult = await musicSearch.search(source, keyword, page, limit)
    try {
      await upsertMusicInfosInTransaction(result.list)
    } catch (error) {
      logger.error('search music info batch upsert failed', error)
      throw new SearchStorageError('搜索结果入库失败')
    }
    const enriched: SearchResultData = {
      ...result,
      list: result.list.map(song => ({ ...song, uid: `${song.source}-${getStorageSongmidForMusicInfo(song)}` })),
    }
    searchCache.set(key, enriched, getSearchCacheTTL())
    logger.debug('[search] page loaded', { source, page, limit, count: enriched.list.length, hasMore: enriched.hasMore })
    return enriched
  })().finally(() => pendingPages.delete(key))
  pendingPages.set(key, pending)
  return pending
}
