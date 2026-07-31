/**
 * 收藏状态（zustand）
 * 维护已收藏的 songId 集合，toggle 时乐观更新、失败回滚。
 */

import { create } from 'zustand'
import { listFavorites, starSong, unstarSong } from '@/lib/api/favorites'

interface FavoritesStore {
  ids: Set<string>
  loaded: boolean
  load: () => Promise<void>
  toggle: (uid: string) => Promise<void>
  isFavorite: (uid: string) => boolean
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,

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
    // 乐观更新
    const optimistic = new Set(get().ids)
    if (wasFav) optimistic.delete(uid)
    else optimistic.add(uid)
    set({ ids: optimistic })

    try {
      if (wasFav) await unstarSong(uid)
      else await starSong(uid)
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
