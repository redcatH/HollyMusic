import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { complete, cookies, logger } = vi.hoisted(() => ({
  complete: vi.fn(), cookies: vi.fn(), logger: { info: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/services/initialization', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/services/initialization')>(), completeInitialization: complete,
}))
vi.mock('@/lib/services/auth', () => ({ createSessionCookies: cookies }))
vi.mock('@/lib/logger', () => ({ logger }))
const { POST } = await import('./route')
const { SetupError } = await import('@/lib/services/initialization')
const { resetLoginRate } = await import('@/lib/server/login-rate-limit')
const goodBody = { password: 'new-password', confirmPassword: 'new-password' }

function request(body: unknown = goodBody, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/setup', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLoginRate('setup:instance')
  vi.stubEnv('SETUP_TOKEN', '')
  complete.mockResolvedValue({ username: 'admin', sessionVersion: 0 })
  cookies.mockReturnValue([{ name: 'holly_user', value: 'admin', httpOnly: true, path: '/', sameSite: 'lax', secure: false, maxAge: 3600 }])
})

describe('POST /api/setup', () => {
  it('成功创建后直接签发会话，响应及日志不返回密码', async () => {
    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(response.cookies.get('holly_user')?.value).toBe('admin')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('new-password')
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('new-password')
  })
  it.each([
    [{ password: 'short', confirmPassword: 'short' }, 400],
    [{ password: 'new-password', confirmPassword: 'different' }, 400],
    [{ password: ' '.repeat(10), confirmPassword: ' '.repeat(10) }, 400],
    [null, 400], [[], 400],
  ])('校验非法内容 %j', async (body, status) => {
    expect((await POST(request(body))).status).toBe(status)
    expect(complete).not.toHaveBeenCalled()
  })
  it('拒绝跨站和表单请求，同时支持保留原 Host 的 Vite/HTTPS 反代', async () => {
    expect((await POST(request(goodBody, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await POST(request(goodBody, { origin: 'https://[' }))).status).toBe(403)
    expect((await POST(request(goodBody, { 'content-type': 'application/x-www-form-urlencoded' }))).status).toBe(415)
    expect((await POST(request(goodBody, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect((await POST(request(goodBody, { origin: 'https://music.example', host: 'music.example' }))).status).toBe(201)
  })
  it('可选初始化码验证及失败限速', async () => {
    vi.stubEnv('SETUP_TOKEN', 'operator-owned-token')
    for (let i = 0; i < 10; i++) expect((await POST(request())).status).toBe(403)
    expect((await POST(request({ ...goodBody, setupToken: 'operator-owned-token' }))).status).toBe(429)
    resetLoginRate('setup:instance')
    expect((await POST(request({ ...goodBody, setupToken: 'operator-owned-token' }))).status).toBe(201)
  })
  it('拒绝大体积请求', async () => {
    expect((await POST(request({ password: 'x'.repeat(5000) }))).status).toBe(413)
    expect(complete).not.toHaveBeenCalled()
  })
  it('签名配置失败时不会先创建账户', async () => {
    cookies.mockImplementation(() => { throw new Error('AUTH_SECRET missing') })
    expect((await POST(request())).status).toBe(503)
    expect(complete).not.toHaveBeenCalled()
  })
  it('重复请求和数据库故障不签发会话', async () => {
    complete.mockRejectedValueOnce(new SetupError('已初始化', 409))
    const conflict = await POST(request())
    expect(conflict.status).toBe(409)
    expect(conflict.cookies.get('holly_user')).toBeUndefined()
    complete.mockRejectedValueOnce(new Error('database unavailable: new-password'))
    expect((await POST(request())).status).toBe(503)
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('new-password')
  })
})
