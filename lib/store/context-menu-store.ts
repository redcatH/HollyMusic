/**
 * 右键菜单状态（zustand）。
 * 用全局 store 而非 React state，避免跨组件状态提升和 portal：
 * SongRow 的 onContextMenu 调 openMenu，App.tsx 顶层渲染一次 <SongContextMenu />。
 */

import { create } from 'zustand'
import type { Track } from '@/lib/types/player'

interface MenuState {
  menu: { track: Track; x: number; y: number } | null
  openMenu: (track: Track, x: number, y: number) => void
  close: () => void
}

export const useContextMenuStore = create<MenuState>(set => ({
  menu: null,
  openMenu: (track, x, y) => set({ menu: { track, x, y } }),
  close: () => set({ menu: null }),
}))
