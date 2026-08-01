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
  orphans?: {
    count: number
    bytes: number
    files: { relativePath: string; size: number }[]
  }
  cleaned?: { deleted: number; bytes: number }
}

export function getCacheStats(): Promise<CacheStats> {
  return apiGet<CacheStats>('admin/cache')
}

export function clearCache(type: 'search' | 'url' | 'audio' | 'all'): Promise<CacheClearResult> {
  return apiPost<CacheClearResult>('admin/cache', { type })
}

/** 扫描磁盘孤儿文件（不删除），返回列表供 admin 确认 */
export function scanOrphans(): Promise<CacheClearResult> {
  return apiPost<CacheClearResult>('admin/cache', { type: 'scan-orphans' })
}

/** 删除扫描出的孤儿文件 */
export function cleanOrphans(): Promise<CacheClearResult> {
  return apiPost<CacheClearResult>('admin/cache', { type: 'clean-orphans' })
}
