import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Fix 3 回归守卫：AUTH_SECRET 解析逻辑。
 * 惰性求值：模块加载不抛错（保证 next build 的 collecting page data 阶段可通过），
 * 首次调用 sign()/verify() 时检查，生产环境缺失/过短必须抛错，杜绝用硬编码 fallback 签 cookie。
 */
describe('AUTH_SECRET resolution (lib/services/auth.ts)', () => {
  beforeEach(() => {
    // 每个用例前清空模块缓存，确保动态 import 重新执行模块顶层（惰性求值需重置缓存）
    vi.resetModules()
  })

  it('生产环境缺失 AUTH_SECRET → 模块可加载，首次 sign() 抛错', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', '')
    const mod = await import('@/lib/services/auth')
    // 模块加载不抛错（构建阶段可通过）
    expect(typeof mod.sign).toBe('function')
    // 首次使用才抛错
    expect(() => mod.sign('admin')).toThrow(/AUTH_SECRET/)
  })

  it('生产环境 AUTH_SECRET 长度不足 32 → 首次 sign() 抛错', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'short')
    const mod = await import('@/lib/services/auth')
    expect(() => mod.sign('admin')).toThrow(/长度不足 32/)
  })

  it('开发环境缺失 AUTH_SECRET → 回退 fallback，sign() 仍可用', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AUTH_SECRET', '')
    const mod = await import('@/lib/services/auth')
    expect(typeof mod.sign).toBe('function')
    expect(mod.sign('admin')).toMatch(/^[0-9a-f]+$/)
  })

  it('配置合法 AUTH_SECRET（≥32）→ sign() 正常签名', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32))
    const mod = await import('@/lib/services/auth')
    expect(mod.sign('admin')).toMatch(/^[0-9a-f]+$/)
  })
})

/**
 * COOKIE_SECURE 回归守卫：Docker 部署（NODE_ENV=production）下 HTTP 直连必须可用。
 * 修复前 secure 硬编码为 NODE_ENV==='production'，导致 HTTP 下浏览器拒绝保存 cookie，
 * 登录后所有请求"未登录"（admin 强制改密流程直接卡死）。
 */
describe('COOKIE_SECURE resolution (lib/services/auth.ts)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('生产环境未设置 COOKIE_SECURE → secure=false（HTTP 直连可用）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32))
    vi.stubEnv('COOKIE_SECURE', '')
    const mod = await import('@/lib/services/auth')
    const cookies = mod.createSessionCookies('admin')
    expect(cookies).toHaveLength(3)
    for (const c of cookies) {
      expect(c.secure).toBe(false)
    }
  })

  it('生产环境 COOKIE_SECURE=true → secure=true（HTTPS 反代）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32))
    vi.stubEnv('COOKIE_SECURE', 'true')
    const mod = await import('@/lib/services/auth')
    const cookies = mod.createSessionCookies('admin')
    for (const c of cookies) {
      expect(c.secure).toBe(true)
    }
  })

  it('生产环境 COOKIE_SECURE=false 显式值 → secure=false', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32))
    vi.stubEnv('COOKIE_SECURE', 'false')
    const mod = await import('@/lib/services/auth')
    const cookies = mod.createSessionCookies('admin')
    for (const c of cookies) {
      expect(c.secure).toBe(false)
    }
  })
})

/**
 * 会话版本（sessionVersion）回归守卫：
 * 签名 = HMAC(username:sessionVersion)，改密码后版本递增 → 旧 cookie 签名即失效。
 * holly_sv 缺失按 0 兼容（升级前签发的旧格式 cookie 不强制重登）；非数字视为伪造拒绝。
 */
describe('sessionVersion signing (lib/services/auth.ts)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32))
  })

  async function loadAuth() {
    return import('@/lib/services/auth')
  }

  it('sign/verify 按 version 往返；不同 version 签名互不通用', async () => {
    const mod = await loadAuth()
    const sig = mod.sign('admin', 3)
    expect(mod.verify('admin', sig, 3)).toBe(true)
    // 旧版本（改密码前）的 cookie 签名不再匹配新版本
    expect(mod.verify('admin', sig, 2)).toBe(false)
    // 反之亦然
    const oldSig = mod.sign('admin', 2)
    expect(mod.verify('admin', oldSig, 3)).toBe(false)
  })

  it('createSessionCookies 携带 holly_sv 且 sig 基于同版本计算', async () => {
    const mod = await loadAuth()
    const cookies = mod.createSessionCookies('admin', 3)
    const byName = Object.fromEntries(cookies.map((c) => [c.name, c.value]))
    expect(byName['holly_sv']).toBe('3')
    expect(byName['holly_sig']).toBe(mod.sign('admin', 3))
    // clearSessionCookies 同步清除三个 cookie
    const cleared = mod.clearSessionCookies()
    expect(cleared.map((c) => c.name).sort()).toEqual(['holly_sig', 'holly_sv', 'holly_user'])
    expect(cleared.every((c) => c.maxAge === 0)).toBe(true)
  })

  it('verifySession：holly_sv=3 + 匹配签名 → 通过并回传版本', async () => {
    const mod = await loadAuth()
    const sig = mod.sign('admin', 3)
    const req = makeReqWithCookies(`holly_user=admin; holly_sv=3; holly_sig=${sig}`)
    const state = mod.verifySession(req)
    expect(state).toEqual({ authenticated: true, username: 'admin', sessionVersion: 3 })
  })

  it('verifySession：缺失 holly_sv（升级前旧格式 cookie）→ 按 version=0 兼容', async () => {
    const mod = await loadAuth()
    // 旧逻辑签的 cookie 等价于 version=0 签名
    const sig = mod.sign('admin', 0)
    const req = makeReqWithCookies(`holly_user=admin; holly_sig=${sig}`)
    const state = mod.verifySession(req)
    expect(state).toEqual({ authenticated: true, username: 'admin', sessionVersion: 0 })
  })

  it('verifySession：holly_sv 非数字 → 拒绝（按伪造处理）', async () => {
    const mod = await loadAuth()
    const req = makeReqWithCookies(`holly_user=admin; holly_sv=abc; holly_sig=${mod.sign('admin', 0)}`)
    const state = mod.verifySession(req)
    expect(state.authenticated).toBe(false)
  })

  it('verifySession：伪造 holly_sv 无法通过（version 参与签名）', async () => {
    const mod = await loadAuth()
    // 攻击者持有 version=0 的有效签名，篡改 holly_sv 冒充更高版本 → 签名校验失败
    const sig = mod.sign('admin', 0)
    const req = makeReqWithCookies(`holly_user=admin; holly_sv=5; holly_sig=${sig}`)
    expect(mod.verifySession(req).authenticated).toBe(false)
  })

  it('verifySession：无 cookie → 未登录', async () => {
    const mod = await loadAuth()
    const state = mod.verifySession(makeReqWithCookies(''))
    expect(state.authenticated).toBe(false)
  })
})

/** 用 Cookie 头构造带会话 cookie 的 NextRequest（verifySession 只读 request.cookies） */
function makeReqWithCookies(cookieHeader: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/me', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  })
}
