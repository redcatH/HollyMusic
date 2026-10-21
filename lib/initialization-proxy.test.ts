import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { status } = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock('@/lib/services/initialization', () => ({ getInitializationStatus: status }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
const { proxy } = await import('../proxy')
it('首装保持健康检查和初始化可用，拦截业务 API 及匿名 Subsonic', async () => {
  status.mockResolvedValue({ setupRequired: true })
  for (const url of ['/api/health', '/api/auth/me', '/api/setup', '/api/site/settings', '/api/site/manifest']) {
    expect((await proxy(new NextRequest(`http://localhost${url}`))).headers.get('x-middleware-next')).toBe('1')
  }
  for (const url of ['/api/search', '/rest/createPlaylist.view']) {
    expect((await proxy(new NextRequest(`http://localhost${url}`))).status).toBe(428)
  }
})
it('已有实例原样放行，数据库故障拒绝业务访问', async () => {
  status.mockResolvedValue({ setupRequired: false })
  expect((await proxy(new NextRequest('http://localhost/api/search'))).headers.get('x-middleware-next')).toBe('1')
  status.mockRejectedValueOnce(new Error('database unavailable'))
  expect((await proxy(new NextRequest('http://localhost/api/search'))).status).toBe(503)
})
