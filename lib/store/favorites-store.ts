/**
 * 收藏状态（zustand）
 * 维护已收藏的 songId 集合，toggle 时乐观更新、失败回滚。
 *
 * version：每次 toggle 成功（DB 已提交）后自增。供订阅者感知"需要刷新"：
 * 收藏列表页据此重新拉取完整列表（含 musicInfo），避免与乐观更新竞态。
 */

import { create } from 'zustand'
import { listFavorites, starSong, unstarSong } from '@/lib/api/favorites'

interface FavoritesStore {
  ids: Set<string>
  loaded: boolean
  /** 每次 toggle 成功后自增；订阅者据此判断是否需要重新拉取完整列表 */
  version: number
  load: () => Promise<void>
  toggle: (uid: string) => Promise<void>
  isFavorite: (uid: string) => boolean
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,
  version: 0,

  load: async () => {
    try {
      const { list } = await listFavorites()
      set({ ids: new Set(list.map(f => f.songId)), loaded: true })
    } catch (e) {
      console.error('[favorites] load failed', e)
      set({ loaded: true })
    }
  },

  toggle: async (uid) => {
    const wasFav = get().ids.has(uid)
    // 乐观更新（立即反映在 SongRow/PlayerBar 的心形图标上）
    const optimistic = new Set(get().ids)
    if (wasFav) optimistic.delete(uid)
    else optimistic.add(uid)
    set({ ids: optimistic })

    try {
      if (wasFav) await unstarSong(uid)
      else await starSong(uid)
      // DB 已提交：通知订阅者（如收藏列表页）刷新完整数据
      set(s => ({ version: s.version + 1 }))
    } catch (e) {
      // 回滚
      const rollback = new Set(get().ids)
      if (wasFav) rollback.add(uid)
      else rollback.delete(uid)
      set({ ids: rollback })
      throw e
    }
  },

  isFavorite: (uid) => get().ids.has(uid),
}))
