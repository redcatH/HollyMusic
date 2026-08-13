import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Fix 3 回归守卫：AUTH_SECRET 解析逻辑。
 * 模块加载时一次性求值，生产环境缺失/过短必须抛错，杜绝用硬编码 fallback 签 cookie。
 */
describe('AUTH_SECRET resolution (lib/services/auth.ts)', () => {
  beforeEach(() => {
    // 每个用例前清空模块缓存，确保动态 import 重新执行模块顶层 resolveAuthSecret()
    vi.resetModules()
  })

  it('生产环境缺失 AUTH_SECRET → 模块加载抛错', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', '')
    await expect(import('@/lib/services/auth')).rejects.toThrow(/AUTH_SECRET/)
  })

  it('生产环境 AUTH_SECRET 长度不足 32 → 抛错', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'short')
    await expect(import('@/lib/services/auth')).rejects.toThrow(/长度不足 32/)
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
    expect(cookies).toHaveLength(2)
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
