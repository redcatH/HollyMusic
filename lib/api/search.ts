/**
 * 搜索 API
 */

import { apiGet } from './client'
import type { Song, SourceType } from '@/lib/types/music'

export interface SearchResultData {
  list: Song[]
  total: number
  page: number
  allPage: number
  limit: number
  source: SourceType
}

export function search(
  source: SourceType,
  keyword: string,
  page = 1,
  limit = 30
): Promise<SearchResultData> {
  return apiGet<SearchResultData>('search', { source, keyword, page, limit })
}
