/**
 * lib/server/login-rate-limit.ts 单元测试
 *
 * Fix 2 回归守卫：双维度限速 key 与锁定行为。
 * - user 维度不受 IP 伪造影响（同一用户名连续失败必锁定）
 * - 不同 key（不同 IP）各自独立计数
 * - 成功登录重置失败计数
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { checkLoginRate, recordLoginFailure, resetLoginRate, buildRateLimitKeys } from './login-rate-limit'

describe('buildRateLimitKeys（双维度 key）', () => {
  it('有 IP 时生成 ip+user 双维度', () => {
    expect(buildRateLimitKeys('1.2.3.4', 'admin')).toEqual(['ip:1.2.3.4', 'user:admin'])
  })

  it('IP 为 null（直连不可信）时仅 user 维度', () => {
    expect(buildRateLimitKeys(null, 'admin')).toEqual(['user:admin'])
  })
})

describe('登录限速（按 key 维度）', () => {
  beforeEach(() => {
    // store 是模块级单例，清理已知 key 保证用例隔离
    for (const key of ['user:admin', 'ip:1.2.3.4', 'ip:10.0.0.0']) resetLoginRate(key)
  })

  it('同一 key 连续失败 10 次触发锁定，锁定期内拒绝', () => {
    // 前 9 次失败放行（MAX_FAILURES=10，第 10 次达到阈值即锁定）
    for (let i = 0; i < 9; i++) {
      expect(recordLoginFailure('user:admin').allowed).toBe(true)
    }
    // 第 10 次失败 → 触发锁定
    expect(recordLoginFailure('user:admin').allowed).toBe(false)
    // 锁定期内 checkLoginRate 拒绝
    expect(checkLoginRate('user:admin').allowed).toBe(false)
  })

  it('伪造 IP 绕不过 user 维度：分散到不同 IP 的失败仍锁定用户名', () => {
    // 模拟爆破：每次换伪造 IP，但同一 username 连续失败
    for (let i = 0; i < 10; i++) {
      recordLoginFailure(`ip:10.0.0.${i}`)
      recordLoginFailure('user:admin')
    }
    expect(checkLoginRate('user:admin').allowed).toBe(false)
    // 但各伪造 IP 自身只失败 1 次，未锁定（IP 维度防御在反代场景仍有效）
    expect(checkLoginRate('ip:10.0.0.0').allowed).toBe(true)
  })

  it('成功登录（resetLoginRate）清空失败计数', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('user:admin')
    resetLoginRate('user:admin')
    expect(checkLoginRate('user:admin').allowed).toBe(true)
    // 清空后可重新累计
    expect(recordLoginFailure('user:admin').allowed).toBe(true)
  })
})
