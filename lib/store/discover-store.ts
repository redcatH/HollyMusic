/**
 * 发现音乐（随机推荐）状态（zustand）
 *
 * 状态放在组件外部 store：离开首页再回来时不会丢失数据，不会重复请求。
 * - fetch(force=false)：有数据且未过期则直接复用，不请求
 * - fetch(force=true)：强制刷新（用于「换一批」按钮）
 * - TTL：5 分钟，到期后再回首页才自动刷新
 * - inflight 去重：避免并发调用同一 size 的请求
 */

import { create } from 'zustand'
import { getRandomSongs } from '@/lib/api/random'
import type { Song } from '@/lib/types/music'

/** 缓存有效期：5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000

interface DiscoverStore {
  songs: Song[]
  loading: boolean
  error: string | null
  /** 上次成功加载的时间戳（ms），用于 TTL 判断 */
  loadedAt: number
  /** 当前请求的大小，避免不同 size 互相覆盖 */
  size: number
  /** 正在飞行中的请求 Promise，用于并发去重 */
  inflight: Promise<void> | null

  /**
   * 拉取随机歌曲。
   * @param size 请求数量
   * @param force true 时跳过缓存强制刷新（用于「换一批」）
   */
  fetch: (size?: number, force?: boolean) => Promise<void>
  /** 「换一批」按钮专用：强制刷新 */
  reload: (size?: number) => Promise<void>
}

export const useDiscoverStore = create<DiscoverStore>((set, get) => ({
  songs: [],
  loading: false,
  error: null,
  loadedAt: 0,
  size: 30,
  inflight: null,

  fetch: async (size = 30, force = false) => {
    const state = get()

    // 缓存命中：已有数据、size 一致、未过期、且非强制刷新 → 直接复用
    if (
      !force &&
      state.size === size &&
      state.songs.length > 0 &&
      Date.now() - state.loadedAt < CACHE_TTL_MS
    ) {
      return
    }

    // 并发去重：同一时刻已有相同请求在飞，复用之
    if (state.inflight) {
      await state.inflight
      return
    }

    const p = (async () => {
      set({ loading: true, error: null, size })
      try {
        const { list } = await getRandomSongs(size)
        set({ songs: list, loading: false, loadedAt: Date.now(), error: null })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : '加载失败' })
      } finally {
        set({ inflight: null })
      }
    })()
    set({ inflight: p })
    await p
  },

  reload: async (size = 30) => {
    await get().fetch(size, true)
  },
}))
