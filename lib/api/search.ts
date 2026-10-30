/**
 * 搜索 API
 */

import { apiGet } from './client'
import type { SearchResult, Song, SourceType } from '@/lib/types/music'

export interface SearchResultData extends Omit<SearchResult, 'list'> {
  list: Song[]
}

export function search(
  source: SourceType,
  keyword: string,
  page = 1,
  limit = 30,
  signal?: AbortSignal,
): Promise<SearchResultData> {
  return apiGet<SearchResultData>('search', { source, keyword, page, limit }, signal)
}
