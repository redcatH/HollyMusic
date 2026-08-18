/**
 * 鉴权 API 客户端
 */

export interface MeResponse {
  authenticated: boolean
  username: string | null
  mustChangePassword: boolean
}

/**
 * 获取当前会话状态。
 * 注意：即使未登录也返回 200，不能走统一 parseJson（它要求 success && data）。
 */
export async function getMe(): Promise<MeResponse> {
  const res = await fetch('/api/auth/me')
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.error?.message || '获取会话失败')
  }
  return json.data as MeResponse
}

export async function login(username: string, password: string): Promise<{ username: string; mustChangePassword: boolean }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || '登录失败')
  }
  return json.data.user as { username: string; mustChangePassword: boolean }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

/**
 * 心跳上报（在线状态）。网络失败静默，不影响用户。
 * 返回 'unauthorized' 表示服务端会话已失效（401，如他处改密码后被踢下线），
 * 调用方应据此强制登出本地状态。
 */
export async function heartbeat(): Promise<'ok' | 'unauthorized'> {
  try {
    const res = await fetch('/api/auth/heartbeat', { method: 'POST' })
    return res.status === 401 ? 'unauthorized' : 'ok'
  } catch {
    return 'ok'
  }
}

/**
 * 自助修改密码。改密成功后 mustChangePassword 会被服务端清除。
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || '修改密码失败')
  }
}
