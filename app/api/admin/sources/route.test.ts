/**
 * app/api/admin/sources/route.ts PATCH 集成测试
 *
 * 鉴权（未登录 401 / 非管理员 403 / 管理员放行）+ updates 参数校验 +
 * 批量更新正常路径（断言 updateSourcesBulk 恰好调用一次）。
 * 通过 vi.mock 隔离 user-context / source-manager-service，不触达真实配置与音源实例。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type AuthMode = 'admin' | 'unauth' | 'forbidden'

let authMode: AuthMode = 'admin'

class MockAuthError extends Error {
  statusCode = 401
  constructor(message = '未登录') {
    super(message)
    this.name = 'AuthError'
  }
}

class MockForbiddenError extends Error {
  constructor(message = '需要管理员权限') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

vi.mock('@/lib/services/user-context', () => ({
  requireAdmin: vi.fn(async () => {
    if (authMode === 'unauth') throw new MockAuthError()
    if (authMode === 'forbidden') throw new MockForbiddenError()
    return { username: 'admin' }
  }),
  AuthError: MockAuthError,
  ForbiddenError: MockForbiddenError,
}))

const updateSourcesBulk = vi.fn(async () => ({ updated: 2 }))

vi.mock('@/lib/services/source-manager-service', () => ({
  addSource: vi.fn(),
  listSourcesWithStatus: vi.fn(async () => []),
  updateSourcesBulk: (...args: unknown[]) => updateSourcesBulk(...(args as [])),
}))

const { PATCH } = await import('./route')

function req(body: unknown) {
  return new NextRequest('http://localhost/api/admin/sources', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

async function respJson(res: Response) {
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('PATCH /api/admin/sources（批量更新）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMode = 'admin'
  })

  it('未登录返回 401', async () => {
    authMode = 'unauth'
    const { status } = await respJson(await PATCH(req({ updates: [{ path: 'a.js', enabled: true }] })))
    expect(status).toBe(401)
    expect(updateSourcesBulk).not.toHaveBeenCalled()
  })

  it('非管理员返回 403', async () => {
    authMode = 'forbidden'
    const { status } = await respJson(await PATCH(req({ updates: [{ path: 'a.js', enabled: true }] })))
    expect(status).toBe(403)
  })

  it.each([
    ['updates 缺失', { foo: 1 }],
    ['空数组', { updates: [] }],
    ['path 非字符串', { updates: [{ path: 123, enabled: true }] }],
    ['path 为空', { updates: [{ path: '  ', enabled: true }] }],
    ['既无 enabled 也无 pt', { updates: [{ path: 'a.js' }] }],
    ['enabled 非布尔', { updates: [{ path: 'a.js', enabled: 'yes' }] }],
    ['pt 非字符串数组', { updates: [{ path: 'a.js', pt: 'kw' }] }],
  ])('参数无效（%s）返回 400', async (_label, body) => {
    const { status, json } = await respJson(await PATCH(req(body)))
    expect(status).toBe(400)
    expect((json.error as { code?: string }).code).toBe('INVALID_PARAMS')
    expect(updateSourcesBulk).not.toHaveBeenCalled()
  })

  it('管理员 + 合法 updates：调用 service 恰好一次并返回结果', async () => {
    const updates = [
      { path: 'custom-sources/a.js', enabled: false },
      { path: 'custom-sources/b.js', pt: ['kw', 'tx'] },
    ]
    const { status, json } = await respJson(await PATCH(req({ updates })))
    expect(status).toBe(200)
    expect(updateSourcesBulk).toHaveBeenCalledTimes(1)
    expect(updateSourcesBulk).toHaveBeenCalledWith(updates)
    expect(json.data).toEqual({ updated: 2 })
  })
})
