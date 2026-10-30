/**
 * 缓存管理器
 * 使用内存缓存，支持不同的过期时间
 */

import type { CacheEntry } from './types/music'

export interface CacheBudget { maxEntries: number; maxBytes: number }
type StoredEntry<T> = CacheEntry<T> & { group: string; bytes: number }

export class CacheManager<T = unknown> {
  private cache: Map<string, StoredEntry<T>>
  private usage = new Map<string, { entries: number; bytes: number }>()
  private evictions = 0
  private hits: number = 0
  private misses: number = 0

  constructor(private budgets?: Record<string, CacheBudget>) {
    this.cache = new Map()
    // 每5分钟清理一次过期缓存
    const timer = setInterval(() => this.cleanExpired(), 5 * 60 * 1000)
    timer.unref?.()
  }

  /**
   * 获取缓存
   */
  get(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) {
      this.misses++
      return null
    }

    // 检查是否过期
    if (Date.now() >= entry.expireAt) {
      this.delete(key)
      this.misses++
      return null
    }

    this.hits++
    // Map 插入顺序即 LRU 顺序，读取时更新。
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.data
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param data 缓存数据
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, data: T, ttl: number): void {
    this.delete(key)
    const group = Object.keys(this.budgets || {}).find(prefix => prefix && key.startsWith(prefix)) || ''
    const budget = this.budgets?.[group]
    let bytes = 0
    if (budget) {
      try {
        bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(data, (_key, value) => value instanceof Map ? [...value] : value))
      } catch { return } // 无法估算的数据不进入受限缓存。
      if (bytes > budget.maxBytes || budget.maxEntries < 1) return
    }
    if (budget) this.cleanExpired()
    const usage = this.usage.get(group) || { entries: 0, bytes: 0 }
    this.usage.set(group, usage)
    if (budget) {
      for (const [oldKey, oldEntry] of this.cache) {
        if (usage.entries < budget.maxEntries && usage.bytes + bytes <= budget.maxBytes) break
        if (oldEntry.group !== group) continue
        this.delete(oldKey)
        this.evictions++
      }
    }
    const entry: StoredEntry<T> = {
      data,
      expireAt: Date.now() + ttl,
      group, bytes,
    }
    this.cache.set(key, entry)
    usage.entries++
    usage.bytes += bytes
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry) {
      const usage = this.usage.get(entry.group)
      if (usage) { usage.entries--; usage.bytes -= entry.bytes }
    }
    return this.cache.delete(key)
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
    this.usage.clear()
    this.evictions = 0
    this.hits = 0
    this.misses = 0
  }

  /**
   * 清理过期缓存
   */
  private cleanExpired(): void {
    const now = Date.now()

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expireAt) this.delete(key)
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const total = this.hits + this.misses
    const hitRate = total > 0 ? (this.hits / total * 100).toFixed(2) : '0.00'

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      evictions: this.evictions,
      estimatedBytes: [...this.usage.values()].reduce((total, value) => total + value.bytes, 0),
    }
  }
}

// 创建不同类型的缓存实例
function budget(prefix: string, maxEntries: number, maxBytes: number): CacheBudget {
  const read = (suffix: string, fallback: number) => {
    const value = Number(process.env[`${prefix}_${suffix}`])
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
  }
  return { maxEntries: read('MAX_ENTRIES', maxEntries), maxBytes: read('MAX_BYTES', maxBytes) }
}

export const searchCache = new CacheManager({
  'search:': budget('WEB_SEARCH_CACHE', 1000, 16 * 1024 * 1024),
  'subsonic-search:': budget('SUBSONIC_SEARCH_CACHE', 1000, 16 * 1024 * 1024),
  'discovery:': budget('DISCOVERY_CACHE', 200, 32 * 1024 * 1024),
  '': budget('OTHER_SEARCH_CACHE', 1000, 16 * 1024 * 1024),
})
export const urlCache = new CacheManager()
