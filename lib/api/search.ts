/**
 * 搜索 API
 */

import { apiGet } from './client'
import type { SearchResult, Song, SourceType } from '@/lib/types/music'

export interface SearchResultData extends Omit<SearchResult, 'list'> {
  list: Song[]
  nextCursor?: string
  totalKnown?: boolean
}

export function search(
  source: SourceType,
  keyword: string,
  page = 1,
  limit = 30,
  signal?: AbortSignal,
  cursor?: string,
): Promise<SearchResultData> {
  return apiGet<SearchResultData>('search', { source, keyword, page, limit, cursor }, signal)
}
