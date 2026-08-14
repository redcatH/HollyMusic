/**
 * 登录限速（进程内，按客户端 IP 维度）
 *
 * 策略：滑动窗口内失败次数达上限 → 临时锁定该 IP，锁定期间拒绝所有登录尝试。
 * 成功登录立即清空该 IP 的失败记录。
 *
 * 仅做失败锁定，不对成功登录限频（避免误伤正常用户）。
 * 进程内 Map 实现，单实例足够；多实例部署可换 Redis。
 */

interface FailureRecord {
  /** 最近失败时间戳数组（ms） */
  times: number[]
  /** 锁定到期时间戳（ms），0 表示未锁定 */
  lockedUntil: number
}

const WINDOW_MS = 5 * 60 * 1000   // 滑动窗口 5 分钟
const MAX_FAILURES = 10            // 窗口内允许失败次数
const LOCK_MS = 15 * 60 * 1000     // 触发后锁定 15 分钟

const store = new Map<string, FailureRecord>()

/**
 * 构造限速双维度 key。
 * - ip 维度仅 TRUST_PROXY=true 时有意义（直连时 IP 头不可信，跳过）
 * - user 维度始终存在（爆破必然针对特定用户名，不受 IP 伪造影响）
 */
export function buildRateLimitKeys(clientIp: string | null, username: string): string[] {
  const keys: string[] = []
  if (clientIp) keys.push(`ip:${clientIp}`)
  if (username) keys.push(`user:${username}`)
  return keys
}

/** 定期清理过期条目，避免内存无限增长 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastCleanup = 0

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [ip, rec] of store) {
    const valid = rec.times.filter(t => now - t < WINDOW_MS)
    if (valid.length === 0 && rec.lockedUntil <= now) {
      store.delete(ip)
    }
  }
}

export interface RateCheckResult {
  /** 是否允许尝试 */
  allowed: boolean
  /** 锁定剩余秒数（allowed=false 时有意义） */
  retryAfterSec: number
}

/**
 * 检查某 IP 是否被允许发起登录尝试。
 * 不增加失败计数，仅判定当前是否处于锁定状态。
 */
export function checkLoginRate(ip: string): RateCheckResult {
  const now = Date.now()
  cleanup(now)
  const rec = store.get(ip)
  if (!rec || rec.lockedUntil <= now) {
    return { allowed: true, retryAfterSec: 0 }
  }
  return { allowed: false, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) }
}

/**
 * 记录一次登录失败。达阈值则锁定。
 */
export function recordLoginFailure(ip: string): RateCheckResult {
  const now = Date.now()
  cleanup(now)
  const rec = store.get(ip) || { times: [], lockedUntil: 0 }
  // 仅保留窗口内的失败
  rec.times = rec.times.filter(t => now - t < WINDOW_MS)
  rec.times.push(now)

  if (rec.times.length >= MAX_FAILURES) {
    rec.lockedUntil = now + LOCK_MS
    rec.times = [] // 锁定后清空计数，锁定期满重新开始
    store.set(ip, rec)
    return { allowed: false, retryAfterSec: Math.ceil(LOCK_MS / 1000) }
  }

  store.set(ip, rec)
  return { allowed: true, retryAfterSec: 0 }
}

/**
 * 登录成功：清空该 IP 的失败记录。
 */
export function resetLoginRate(ip: string): void {
  store.delete(ip)
}

/** 锁定中的 IP 视图（供后台管理展示） */
export interface LockedIpView {
  ip: string
  /** 锁定剩余秒数 */
  retryAfterSec: number
  /** 窗口内累计失败次数（锁定后清零，故通常为 0） */
  failures: number
}

/**
 * 列出当前锁定中的 IP（后台管理用）。
 */
export function listLockedIps(): LockedIpView[] {
  const now = Date.now()
  const result: LockedIpView[] = []
  for (const [ip, rec] of store) {
    if (rec.lockedUntil > now) {
      result.push({
        ip,
        retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000),
        failures: rec.times.length,
      })
    }
  }
  return result.sort((a, b) => b.retryAfterSec - a.retryAfterSec)
}

/**
 * 解锁指定 IP（后台管理用）。返回是否实际解锁了某个锁定。
 */
export function unlockIp(ip: string): boolean {
  const rec = store.get(ip)
  if (!rec) return false
  const wasLocked = rec.lockedUntil > Date.now()
  store.delete(ip)
  return wasLocked
}

/**
 * 清空所有登录锁定记录（后台管理用）。返回被清除的条目数。
 */
export function clearAllLocks(): number {
  const now = Date.now()
  let count = 0
  for (const [ip, rec] of store) {
    if (rec.lockedUntil > now) count++
    store.delete(ip)
  }
  return count
}

const loginRateApi = { checkLoginRate, recordLoginFailure, resetLoginRate, listLockedIps, unlockIp, clearAllLocks }
export default loginRateApi
