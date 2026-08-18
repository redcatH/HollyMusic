/**
 * app/api/auth/change-password/route.ts 集成测试
 *
 * 核心守卫：改密码成功后 sessionVersion 必须 +1（其它设备旧会话立即失效），
 * 并为当前设备重发新版本 cookie（本设备不掉线）。
 *
 * 通过 vi.mock 隔离 requireUser / PrismaClient，不触达真实 DB。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// --- mock requireUser / AuthError ------------------------------------------

type AuthMode = 'ok' | 'unauth'

let authMode: AuthMode = 'ok'

class MockAuthError extends Error {
  statusCode = 401
  constructor(message = '未登录') {
    super(message)
    this.name = 'AuthError'
  }
}

vi.mock('@/lib/services/user-context', () => ({
  requireUser: vi.fn(async () => {
    if (authMode === 'unauth') throw new MockAuthError('未登录')
    return { id: 1, username: 'tester' }
  }),
  AuthError: MockAuthError,
}))

// --- mock PrismaClient ------------------------------------------------------

const dbUser = {
  findUnique: vi.fn(),
  update: vi.fn(),
}

vi.mock('@/lib/generated/prisma', () => ({
  PrismaClient: class MockPrismaClient {
    user = dbUser
  },
}))

// --- 辅助 -------------------------------------------------------------------

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// 延迟导入，确保 vi.mock 先生效（sign 为纯函数，不 mock，直接引入真实实现）
const { POST } = await import('./route')
const { sign } = await import('@/lib/services/auth')

// ===========================================================================

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    authMode = 'ok'
    dbUser.findUnique.mockReset()
    dbUser.update.mockReset()
  })

  it('改密成功 → sessionVersion +1，当前设备重发新版本 cookie', async () => {
    dbUser.findUnique.mockResolvedValue({
      id: 1,
      username: 'tester',
      subsonicSecret: 'old123',
      sessionVersion: 3,
      mustChangePassword: false,
    })
    dbUser.update.mockResolvedValue({ id: 1, username: 'tester', sessionVersion: 4 })

    const res = await POST(makePostRequest({ currentPassword: 'old123', newPassword: 'new456' }))
    expect(res.status).toBe(200)

    // 关键断言：版本递增写入 DB（其它设备旧会话因此失效）
    expect(dbUser.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        subsonicSecret: 'new456',
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
      },
    })

    // 当前设备不掉线：响应携带新版本 cookie，签名与 holly_sv=4 匹配
    expect(res.cookies.get('holly_sv')?.value).toBe('4')
    expect(res.cookies.get('holly_sig')?.value).toBe(sign('tester', 4))
    expect(res.cookies.get('holly_user')?.value).toBe('tester')
  })

  it('当前密码错误 → 401 且不触发任何 DB 更新', async () => {
    dbUser.findUnique.mockResolvedValue({
      id: 1,
      username: 'tester',
      subsonicSecret: 'old123',
      sessionVersion: 3,
      mustChangePassword: false,
    })

    const res = await POST(makePostRequest({ currentPassword: 'wrong9', newPassword: 'new456' }))
    expect(res.status).toBe(401)
    expect(dbUser.update).not.toHaveBeenCalled()
    expect(res.cookies.get('holly_sv')?.value).toBeUndefined()
  })

  it('未登录 → 401', async () => {
    authMode = 'unauth'
    const res = await POST(makePostRequest({ currentPassword: 'old123', newPassword: 'new456' }))
    expect(res.status).toBe(401)
    expect(dbUser.update).not.toHaveBeenCalled()
  })

  it('新密码长度不足 6 位 → 400', async () => {
    const res = await POST(makePostRequest({ currentPassword: 'old123', newPassword: 'abc' }))
    expect(res.status).toBe(400)
    expect(dbUser.findUnique).not.toHaveBeenCalled()
  })

  it('新密码与当前密码相同 → 400 且不更新', async () => {
    dbUser.findUnique.mockResolvedValue({
      id: 1,
      username: 'tester',
      subsonicSecret: 'same123',
      sessionVersion: 0,
      mustChangePassword: false,
    })
    const res = await POST(makePostRequest({ currentPassword: 'same123', newPassword: 'same123' }))
    expect(res.status).toBe(400)
    expect(dbUser.update).not.toHaveBeenCalled()
  })
})
