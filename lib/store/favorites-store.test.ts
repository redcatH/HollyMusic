/**
 * lib/store/favorites-store.ts 测试
 *
 * P0 回归守卫：load/toggle 全局串行化。
 * - 快速连点：请求按点击顺序落地（unstar → star），最终 UI 状态与请求序列一致；
 * - load 进行中 toggle：load 快照不会插队覆盖乐观更新；
 * - 失败回滚、分页全量同步、toggle 成功后的延迟 resync。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { listFavorites, starSong, unstarSong } = vi.hoisted(() => ({
  listFavorites: vi.fn(),
  starSong: vi.fn(),
  unstarSong: vi.fn(),
}))

vi.mock('@/lib/api/favorites', () => ({
  listFavorites,
  starSong,
  unstarSong,
}))

const { useFavoritesStore } = await import('@/lib/store/favorites-store')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

afterEach(() => useFavoritesStore.getState().reset())

/** 生成 n 条收藏响应 */
function makeList(n: number, prefix = 'kw'): Array<{ songId: string }> {
  return Array.from({ length: n }, (_, i) => ({ songId: `${prefix}-${i}` }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // 默认空列表，避免 toggle 成功后的 resync load 产生未处理拒绝
  listFavorites.mockResolvedValue({ list: [], total: 0 })
  starSong.mockResolvedValue({ starred: true })
  unstarSong.mockResolvedValue({ starred: false })
  // reset 同时清掉 pending 的 resync 定时器，隔离用例
  useFavoritesStore.getState().reset()
})

describe('toggle 串行化（P0）', () => {
  it('快速连点：请求按点击顺序落地，不并发乱序', async () => {
    const calls: string[] = []
    // 第一次（取消收藏）故意慢 30ms：若未串行化，第二次（收藏）会先落地
    unstarSong.mockImplementation(async () => {
      calls.push('unstar:start')
      await sleep(30)
      calls.push('unstar:end')
    })
    starSong.mockImplementation(async () => {
      calls.push('star')
    })

    useFavoritesStore.setState({ ids: new Set(['kw-1']) })
    const p1 = useFavoritesStore.getState().toggle('kw-1')
    const p2 = useFavoritesStore.getState().toggle('kw-1')
    await Promise.all([p1, p2])

    expect(calls).toEqual(['unstar:start', 'unstar:end', 'star'])
    // 两次点击 = 取消再收藏，最终仍为已收藏，与请求序列一致
    expect(useFavoritesStore.getState().ids.has('kw-1')).toBe(true)
  })

  it('乐观更新失败时回滚并向上抛错', async () => {
    starSong.mockRejectedValueOnce(new Error('network down'))

    useFavoritesStore.setState({ ids: new Set<string>() })
    await expect(useFavoritesStore.getState().toggle('kw-9')).rejects.toThrow('network down')
    expect(useFavoritesStore.getState().ids.has('kw-9')).toBe(false)
  })

  it('toggle 成功后 version 自增（收藏页刷新信号）', async () => {
    useFavoritesStore.setState({ ids: new Set<string>(), version: 0 })
    await useFavoritesStore.getState().toggle('kw-1')
    expect(useFavoritesStore.getState().version).toBe(1)
  })

  it('toggle 成功后延迟 resync 与服务端对齐（去抖，只触发一次）', async () => {
    vi.useFakeTimers()
    try {
      useFavoritesStore.setState({ ids: new Set<string>() })
      await useFavoritesStore.getState().toggle('kw-1')
      // 去抖窗口内不触发
      expect(listFavorites).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(600)
      expect(listFavorites).toHaveBeenCalledTimes(1)
      expect(listFavorites).toHaveBeenCalledWith(500, 0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('load 串行化与分页（P0/P2）', () => {
  it('toggle 进行中 load：load 排队等待，不插队覆盖乐观更新', async () => {
    const order: string[] = []
    starSong.mockImplementationOnce(async () => {
      order.push('star:start')
      await sleep(20)
      order.push('star:end')
    })
    // load 的快照返回服务端视角（toggle 已提交，kw-1 已收藏）
    listFavorites.mockImplementationOnce(async () => {
      order.push('load')
      return { list: [{ songId: 'kw-1' }], total: 1 }
    })

    useFavoritesStore.setState({ ids: new Set<string>() })
    const toggleP = useFavoritesStore.getState().toggle('kw-1')
    const loadP = useFavoritesStore.getState().load()
    await Promise.all([toggleP, loadP])

    // 严格串行：toggle 完成后 load 才执行，快照不会插进 toggle 中间
    expect(order).toEqual(['star:start', 'star:end', 'load'])
    expect(useFavoritesStore.getState().ids.has('kw-1')).toBe(true)
  })

  it('load 分页拉全量：超过单页上限继续翻页', async () => {
    listFavorites
      .mockResolvedValueOnce({ list: makeList(500), total: 501 })
      .mockResolvedValueOnce({ list: makeList(1, 'tx'), total: 501 })

    await useFavoritesStore.getState().load()

    expect(listFavorites).toHaveBeenNthCalledWith(1, 500, 0)
    expect(listFavorites).toHaveBeenNthCalledWith(2, 500, 500)
    expect(useFavoritesStore.getState().ids.size).toBe(501)
    expect(useFavoritesStore.getState().ids.has('tx-0')).toBe(true)
  })

  it('load 失败保留现有集合，不抛错', async () => {
    useFavoritesStore.setState({ ids: new Set(['kw-1']) })
    listFavorites.mockRejectedValueOnce(new Error('server error'))

    await expect(useFavoritesStore.getState().load()).resolves.toBeUndefined()
    expect(useFavoritesStore.getState().ids.has('kw-1')).toBe(true)
  })
})

describe('reset', () => {
  it('丢弃旧账号排队写操作，且新账号不必等待旧请求', async () => {
    const oldPage = deferred<{ list: { songId: string }[]; total: number }>()
    listFavorites.mockReturnValueOnce(oldPage.promise)
    const load = useFavoritesStore.getState().load()
    await Promise.resolve()
    const oldToggle = useFavoritesStore.getState().toggle('kw-old')
    useFavoritesStore.getState().reset()
    await useFavoritesStore.getState().toggle('kw-new')
    oldPage.resolve({ list: makeList(500), total: 600 })
    await Promise.all([load, oldToggle])
    expect(starSong.mock.calls).toEqual([['kw-new']])
    expect(listFavorites).toHaveBeenCalledTimes(1) // 旧账号不得继续翻页
    expect([...useFavoritesStore.getState().ids]).toEqual(['kw-new'])
  })

  it.each(['success', 'failure'])('旧账号在途写请求 %s 不覆盖新状态或重新安排同步', async outcome => {
    vi.useFakeTimers()
    try {
      const oldWrite = deferred<void>()
      starSong.mockReturnValueOnce(oldWrite.promise)
      const oldToggle = useFavoritesStore.getState().toggle('kw-old')
      await Promise.resolve()
      useFavoritesStore.getState().reset()
      useFavoritesStore.setState({ ids: new Set(['kw-new']), version: 10 })
      if (outcome === 'success') oldWrite.resolve()
      else oldWrite.reject(new Error('old session failed'))
      await oldToggle
      await vi.advanceTimersByTimeAsync(1000)
      expect([...useFavoritesStore.getState().ids]).toEqual(['kw-new'])
      expect(useFavoritesStore.getState().version).toBe(10)
      expect(listFavorites).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('清空集合并重置 version', () => {
    useFavoritesStore.setState({ ids: new Set(['kw-1']), version: 7 })
    useFavoritesStore.getState().reset()
    expect(useFavoritesStore.getState().ids.size).toBe(0)
    expect(useFavoritesStore.getState().version).toBe(0)
  })
})
