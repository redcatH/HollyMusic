/**
 * 导航 pending 状态（zustand）
 *
 * 用于实现 SPA 式路由切换：
 * - Sidebar 点击导航时立即 setPendingPath(href) + setActivePath(href)
 * - AppShell main 区域：pendingPath !== pathname 时显示 loading 骨架
 * - Sidebar 导航高亮：优先用 activePath（点击即变），pathname 更新后同步清除
 * - Next.js RSC 返回后 pathname 更新 → 与 pendingPath 相等 → 骨架自动消失
 *
 * 这样右侧面板和左侧高亮点击即切换，不等 RSC fetch 返回。
 */

import { create } from 'zustand'

interface NavStore {
  /** 正在导航中的目标路径；null 表示无导航在途 */
  pendingPath: string | null
  setPendingPath: (path: string | null) => void
  /** 乐观高亮路径（点击即变）；null 时回退到 pathname 判断 */
  activePath: string | null
  setActivePath: (path: string | null) => void
}

export const useNavStore = create<NavStore>((set) => ({
  pendingPath: null,
  setPendingPath: (path) => set({ pendingPath: path }),
  activePath: null,
  setActivePath: (path) => set({ activePath: path }),
}))
