/**
 * 鉴权状态（zustand）
 * 启动时通过 getMe 获取会话；提供 login / logout。
 * authenticated 为 null 表示尚未加载完成（用于路由守卫区分"加载中"与"未登录"）。
 */

import { create } from 'zustand'
import { getMe, login as apiLogin, logout as apiLogout } from '@/lib/api/auth'

interface AuthStore {
  authenticated: boolean | null
  username: string | null
  loading: boolean
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  authenticated: null,
  username: null,
  loading: false,

  init: async () => {
    set({ loading: true })
    try {
      const me = await getMe()
      set({ authenticated: me.authenticated, username: me.username, loading: false })
    } catch {
      set({ authenticated: false, username: null, loading: false })
    }
  },

  login: async (username, password) => {
    const res = await apiLogin(username, password)
    set({ authenticated: true, username: res.username })
  },

  logout: async () => {
    await apiLogout()
    set({ authenticated: false, username: null })
  },
}))

export const useAuth = useAuthStore
