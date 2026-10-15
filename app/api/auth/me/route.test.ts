import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { status, auth } = vi.hoisted(() => ({ status: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/services/initialization', () => ({ getInitializationStatus: status }))
vi.mock('@/lib/services/user-context', () => ({ getAuthState: auth }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
const { GET } = await import('./route')
beforeEach(() => {
  status.mockResolvedValue({ setupRequired: true, setupRecoveryRequired: false, setupTokenRequired: false })
  auth.mockResolvedValue({ authenticated: false, user: null, mustChangePassword: false })
})
it('会话接口同时返回首装状态并禁止缓存', async () => {
  const response = await GET(new NextRequest('http://localhost/api/auth/me'))
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await response.json()).data).toMatchObject({ authenticated: false, setupRequired: true })
})
it('数据库读取失败返回不可用，不伪装为待初始化', async () => {
  status.mockRejectedValueOnce(new Error('corrupt database'))
  const response = await GET(new NextRequest('http://localhost/api/auth/me'))
  expect(response.status).toBe(503)
  expect((await response.json()).data).toBeUndefined()
})
it('旧管理员会话及改密标记原样返回', async () => {
  status.mockResolvedValue({ setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false })
  auth.mockResolvedValue({ authenticated: true, user: { username: 'admin' }, mustChangePassword: true })
  const response = await GET(new NextRequest('http://localhost/api/auth/me'))
  expect((await response.json()).data).toMatchObject({ authenticated: true, username: 'admin', mustChangePassword: true, setupRequired: false })
})
