/**
 * lib/auth.ts 单元测试
 *
 * Fix 1 回归守卫：Subsonic /rest/* 认证开关与 resolveUserFromParams 行为。
 * - 认证开启（默认）：无 token 直接拒绝，且不创建用户（防"传 u=xxx 即建号/冒名"）
 * - REQUIRE_AUTH=false：保留旧 scheme C fallback（仅传用户名即视为该用户）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveUserFromParams, isRestAuthEnabled } from './auth'
import { getOrCreateUserByName, verifyTForUser } from './favorites'

vi.mock('./favorites', () => ({
  getOrCreateUserByName: vi.fn(async (username: string) => ({ id: 1, username })),
  verifyTForUser: vi.fn(async () => false),
}))

describe('REST 认证开关 (isRestAuthEnabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('默认（未设 REQUIRE_AUTH）→ 认证开启', () => {
    expect(isRestAuthEnabled()).toBe(true)
  })

  it('REQUIRE_AUTH=false|off|none（不区分大小写）→ 认证关闭', () => {
    for (const v of ['false', 'off', 'none', 'FALSE', 'Off', 'None']) {
      vi.stubEnv('REQUIRE_AUTH', v)
      expect(isRestAuthEnabled()).toBe(false)
    }
  })

  it('REQUIRE_AUTH 为方法列表 → 认证开启（精细控制模式）', () => {
    vi.stubEnv('REQUIRE_AUTH', 'stream,getSong')
    expect(isRestAuthEnabled()).toBe(true)
  })
})

describe('resolveUserFromParams 认证行为', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('认证开启（默认）且无 token → auth_required，且不创建用户', async () => {
    const res = await resolveUserFromParams('admin', null, null)
    expect(res).toEqual({ user: null, verified: false, error: 'auth_required' })
    expect(getOrCreateUserByName).not.toHaveBeenCalled()
  })

  it('认证关闭（REQUIRE_AUTH=false）→ 保留旧 fallback（仅传用户名即建/取用户）', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
    const res = await resolveUserFromParams('admin', null, null)
    expect(res).toEqual({ user: { id: 1, username: 'admin' }, verified: false })
    expect(getOrCreateUserByName).toHaveBeenCalledWith('admin')
  })

  it('带 token 但校验失败 → invalid_t', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
    const res = await resolveUserFromParams('admin', 'bad', 'salt')
    expect(res.error).toBe('invalid_t')
    expect(verifyTForUser).toHaveBeenCalledWith('admin', 'bad', 'salt')
  })

  it('缺失用户名 → missing_username', async () => {
    const res = await resolveUserFromParams('', null, null)
    expect(res.error).toBe('missing_username')
  })
})
