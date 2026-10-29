import { searchCache } from '@/lib/cache-manager'
import { getSearchCacheTTL } from '@/lib/cache-config'
import { getStorageSongmidForMusicInfo, upsertMusicInfosInTransaction } from '@/lib/db'
import { logger } from '@/lib/logger'
import * as musicSearch from '@/lib/music-core/music-search'
import type { SearchResultData } from '@/lib/api/search'
import type { SearchResult, SourceType } from '@/lib/types/music'

const pendingPages = new Map<string, Promise<SearchResultData>>()

export class SearchStorageError extends Error {}

/** Web 搜索服务：同一页共享上游请求和入库事务，只有成功数据才能缓存。 */
export async function searchSongs(source: SourceType, keyword: string, page: number, requestedLimit: number): Promise<SearchResultData> {
  const limit = musicSearch.getSearchPageSize(source, requestedLimit)
  const key = `search:v2:${source}:${encodeURIComponent(keyword)}:${page}:${limit}`
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
