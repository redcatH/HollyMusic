/**
 * 鉴权状态（zustand）
 * 启动时通过 getMe 获取会话；提供 login / logout。
 * authenticated 为 null 表示尚未加载完成（用于路由守卫区分"加载中"与"未登录"）。
 *
 * 已登录时启动心跳定时器（每 2 分钟上报一次，用于在线状态推断），登出/未登录时停止。
 * // ponytail: 后台 tab 会节流 setInterval（~1分钟），TTL 5 分钟有容错。如需更精准可加 visibilitychange 即时上报。
 */

import { create } from 'zustand'
import { getMe, login as apiLogin, logout as apiLogout, heartbeat } from '@/lib/api/auth'

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    heartbeat().catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

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
      if (me.authenticated) startHeartbeat()
    } catch {
      set({ authenticated: false, username: null, loading: false })
    }
  },

  login: async (username, password) => {
    const res = await apiLogin(username, password)
    set({ authenticated: true, username: res.username })
    startHeartbeat()
  },

  logout: async () => {
    stopHeartbeat()
    await apiLogout()
    set({ authenticated: false, username: null })
  },
}))

export const useAuth = useAuthStore
