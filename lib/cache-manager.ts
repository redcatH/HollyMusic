/**
 * 缓存管理器
 * 使用内存缓存，支持不同的过期时间
 */

import type { CacheEntry } from './types/music'

export class CacheManager<T = unknown> {
  private cache: Map<string, CacheEntry<T>>
  private hits: number = 0
  private misses: number = 0

  constructor() {
    this.cache = new Map()
    // 每5分钟清理一次过期缓存
    setInterval(() => this.cleanExpired(), 5 * 60 * 1000)
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
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    this.hits++
    return entry.data
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param data 缓存数据
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, data: T, ttl: number): void {
    const entry: CacheEntry<T> = {
      data,
      expireAt: Date.now() + ttl,
    }
    this.cache.set(key, entry)
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  /**
   * 清理过期缓存
   */
  private cleanExpired(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expireAt) {
        this.cache.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log(`[Cache] 清理了 ${cleaned} 个过期缓存项`)
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
    }
  }
}

// 创建不同类型的缓存实例
export const searchCache = new CacheManager()
export const urlCache = new CacheManager()
