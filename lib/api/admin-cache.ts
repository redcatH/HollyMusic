/**
 * 缓存管理 API 客户端（admin 专属）
 */

import { apiGet, apiPost } from './client'

export interface MemoryCacheStats {
  size: number
  hits: number
  misses: number
  hitRate: string
}

export interface DiskCacheStats {
  total: number
  downloading: number
  complete: number
  partial: number
  totalBytes: number
  quotaBytes: number
  enabled: boolean
}

export interface CacheStats {
  memory: {
    search: MemoryCacheStats
    url: MemoryCacheStats
  }
  disk: DiskCacheStats
}

export interface CacheClearResult {
  type: string
  search: MemoryCacheStats
  url: MemoryCacheStats
  audio?: { count: number; bytes: number } | null
}

export function getCacheStats(): Promise<CacheStats> {
  return apiGet<CacheStats>('admin/cache')
}

export function clearCache(type: 'search' | 'url' | 'audio' | 'all'): Promise<CacheClearResult> {
  return apiPost<CacheClearResult>('admin/cache', { type })
}
