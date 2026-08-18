/**
 * 鉴权状态（zustand）
 * 启动时通过 getMe 获取会话；提供 login / logout。
 * authenticated 为 null 表示尚未加载完成（用于路由守卫区分"加载中"与"未登录"）。
 *
 * 已登录时启动心跳定时器（每 2 分钟上报一次，用于在线状态推断），登出/未登录时停止。
 * 心跳若返回 401（会话被服务端失效，如他处改密码），自动清空本地登录态强制下线。
 * // ponytail: 后台 tab 会节流 setInterval（~1分钟），TTL 5 分钟有容错。如需更精准可加 visibilitychange 即时上报。
 */

import { create } from 'zustand'
import { getMe, login as apiLogin, logout as apiLogout, heartbeat, changePassword as apiChangePassword } from '@/lib/api/auth'

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    heartbeat()
      .then((result) => {
        if (result === 'unauthorized') {
          // 服务端会话已失效（如该账号在别处改了密码），本地强制下线并停止心跳
          stopHeartbeat()
          useAuthStore.setState({ authenticated: false, username: null, mustChangePassword: false })
        }
      })
      .catch(() => {})
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
  /** 是否需要强制修改密码（首次登录/管理员重置后为 true） */
  mustChangePassword: boolean
  loading: boolean
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** 自助改密，成功后清除 mustChangePassword */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  authenticated: null,
  username: null,
  mustChangePassword: false,
  loading: false,

  init: async () => {
    set({ loading: true })
    try {
      const me = await getMe()
      set({ authenticated: me.authenticated, username: me.username, mustChangePassword: me.mustChangePassword, loading: false })
      if (me.authenticated) startHeartbeat()
    } catch {
      set({ authenticated: false, username: null, mustChangePassword: false, loading: false })
    }
  },

  login: async (username, password) => {
    const res = await apiLogin(username, password)
    set({ authenticated: true, username: res.username, mustChangePassword: res.mustChangePassword })
    startHeartbeat()
  },

  logout: async () => {
    stopHeartbeat()
    await apiLogout()
    set({ authenticated: false, username: null, mustChangePassword: false })
  },

  changePassword: async (currentPassword, newPassword) => {
    await apiChangePassword(currentPassword, newPassword)
    set({ mustChangePassword: false })
  },
}))

export const useAuth = useAuthStore
