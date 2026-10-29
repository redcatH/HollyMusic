import { afterEach, expect, it, vi } from 'vitest'
import { CacheManager } from './cache-manager'

afterEach(() => vi.useRealTimers())

it('按分区 LRU 淘汰，网页分页不能挤掉 Subsonic', () => {
  const cache = new CacheManager({ 'search:': { maxEntries: 2, maxBytes: 1000 }, 'subsonic:': { maxEntries: 1, maxBytes: 1000 } })
  cache.set('subsonic:1', 'subsonic', 1000)
  cache.set('search:1', 'one', 1000)
  cache.set('search:2', 'two', 1000)
  cache.get('search:1')
  cache.set('search:3', 'three', 1000)
  expect(cache.get('search:2')).toBeNull()
  expect(cache.get('search:1')).toBe('one')
  expect(cache.get('subsonic:1')).toBe('subsonic')
  expect(cache.getStats()).toMatchObject({ size: 3, evictions: 1 })
})

it('按字节预算淘汰，Map 正确计量，超大单项不缓存', () => {
  const cache = new CacheManager({ '': { maxEntries: 100, maxBytes: 100 } })
  cache.set('first', 'x'.repeat(60), 1000)
  cache.set('second', 'x'.repeat(60), 1000)
  expect(cache.get('first')).toBeNull()
  expect(cache.getStats().estimatedBytes).toBeLessThanOrEqual(100)
  cache.set('huge', new Map([['cover', 'x'.repeat(200)]]), 1000)
  expect(cache.get('huge')).toBeNull()
  expect(cache.get('second')).not.toBeNull()
})

it('替换、过期、删除、清空都释放容量', () => {
  vi.useFakeTimers()
  const cache = new CacheManager({ '': { maxEntries: 2, maxBytes: 100 } })
  cache.set('a', 'a', 100)
  cache.set('a', 'b', 100)
  expect(cache.getStats().size).toBe(1)
  vi.advanceTimersByTime(100)
  expect(cache.get('a')).toBeNull()
  expect(cache.getStats().estimatedBytes).toBe(0)
  cache.set('a', 'a', 100)
  cache.delete('a')
  expect(cache.getStats().estimatedBytes).toBe(0)
  cache.set('a', 'a', 100)
  cache.clear()
  expect(cache.getStats()).toMatchObject({ size: 0, estimatedBytes: 0, evictions: 0 })
})
