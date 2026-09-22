/**
 * 收藏状态（zustand）
 * 维护已收藏的 songId 集合，toggle 时乐观更新、失败回滚。
 *
 * 并发模型（P0 修复）：
 * load 与 toggle 全部经过模块级串行队列，严格按提交顺序执行：
 * - 快速连点收藏：star/unstar 不会并发乱序落地，每次 toggle 在出队时
 *   才读取当前集合计算意图，请求顺序 = 点击顺序，UI 与 DB 最终一致；
 * - load 进行中点收藏：load 的快照不会插在 toggle 中间覆盖乐观更新。
 * toggle 成功后延迟触发一次 load 与服务端对齐（连点只合并为一次请求）。
 *
 * version：每次 toggle 成功（DB 已提交）后自增。供订阅者感知"需要刷新"：
 * 收藏列表页据此重新拉取完整列表（含 musicInfo）。
 */

import { create } from 'zustand'
import { listFavorites, starSong, unstarSong } from '@/lib/api/favorites'
import { logger } from '@/lib/logger'

/** 全量同步的分页大小，与服务端单页上限（app/api/favorites 500）对齐 */
const SYNC_PAGE_SIZE = 500

/** toggle 成功后延迟重同步的间隔：连点多次只触发一次 load */
const RESYNC_DELAY_MS = 600

/**
 * 全局串行队列：收藏的读同步（load）与写操作（toggle）按提交顺序依次执行。
 * 队列吞掉前一个任务的错误，保证后续任务不受影响；任务自身的错误仍抛给调用方。
 */
let queue: Promise<unknown> = Promise.resolve()
let sessionGeneration = 0
function enqueue(task: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
  const generation = sessionGeneration
  const isCurrent = () => generation === sessionGeneration
  const run = queue.then(() => {
    if (isCurrent()) return task(isCurrent)
  })
  queue = run.catch(() => {})
  return run
}

let resyncTimer: ReturnType<typeof setTimeout> | null = null

interface FavoritesStore {
  ids: Set<string>
  /** 每次 toggle 成功后自增；订阅者据此判断是否需要重新拉取完整列表 */
  version: number
  load: () => Promise<void>
  toggle: (uid: string) => Promise<void>
  isFavorite: (uid: string) => boolean
  /** 登出/切换用户时清空，避免上一个用户的收藏红心残留 */
  reset: () => void
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  ids: new Set<string>(),
  version: 0,

  load: () =>
    enqueue(async isCurrent => {
      try {
        // 分页拉全量：收藏数超过单页上限时，心形状态才不会漏判
        const ids = new Set<string>()
        let offset = 0
        for (;;) {
          const { list } = await listFavorites(SYNC_PAGE_SIZE, offset)
          if (!isCurrent()) return
          for (const f of list) ids.add(f.songId)
          if (list.length < SYNC_PAGE_SIZE) break
          offset += list.length
        }
        set({ ids })
      } catch (e) {
        if (!isCurrent()) return
        // 拉取失败保留现有集合（多为网络抖动），不打断 UI
        logger.error('[favorites] load failed', e)
      }
    }),

  toggle: (uid) =>
    enqueue(async isCurrent => {
      // 出队时才读当前集合：连点时每次 toggle 基于上一次结果计算意图
      const wasFav = get().ids.has(uid)
      // 乐观更新（立即反映在 SongRow/PlayerBar 的心形图标上）
      const optimistic = new Set(get().ids)
      if (wasFav) optimistic.delete(uid)
      else optimistic.add(uid)
      set({ ids: optimistic })

      try {
        if (wasFav) await unstarSong(uid)
        else await starSong(uid)
        if (!isCurrent()) return
        // DB 已提交：通知订阅者（如收藏列表页）刷新完整数据
        set(s => ({ version: s.version + 1 }))
        // 延迟与服务端对齐（兜底：多端同时操作等乐观更新覆盖不到的场景）
        scheduleResync()
      } catch (e) {
        if (!isCurrent()) return
        // 回滚
        const rollback = new Set(get().ids)
        if (wasFav) rollback.add(uid)
        else rollback.delete(uid)
        set({ ids: rollback })
        throw e
      }
    }),

  isFavorite: (uid) => get().ids.has(uid),

  reset: () => {
    // 旧请求即使晚返回也不能写状态、继续翻页或向新账号提交排队中的操作。
    sessionGeneration++
    queue = Promise.resolve()
    if (resyncTimer !== null) {
      clearTimeout(resyncTimer)
      resyncTimer = null
    }
    set({ ids: new Set<string>(), version: 0 })
  },
}))

function scheduleResync() {
  if (resyncTimer !== null) clearTimeout(resyncTimer)
  resyncTimer = setTimeout(() => {
    resyncTimer = null
    void useFavoritesStore.getState().load()
  }, RESYNC_DELAY_MS)
}
