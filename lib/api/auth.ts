/**
 * 鉴权 API 客户端
 */

export interface MeResponse {
  authenticated: boolean
  username: string | null
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

export async function login(username: string, password: string): Promise<{ username: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || '登录失败')
  }
  return json.data.user as { username: string }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}
