/**
 * 签名 cookie 鉴权
 *
 * 用 HMAC-SHA256 对用户名签名，签发 holly_user + holly_sig 两个 cookie。
 * 替代原先可伪造的明文 holly_user cookie。
 *
 * AUTH_SECRET 从环境变量读取；缺失时使用固定 fallback 并告警（仅开发环境可用）。
 */

import crypto from 'crypto'
import type { NextRequest } from 'next/server'

const COOKIE_USER = 'holly_user'
const COOKIE_SIG = 'holly_sig'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 天

/** 与 next 的 cookies.set 兼容的选项结构 */
export interface CookieOption {
  name: string
  value: string
  httpOnly: boolean
  path: string
  sameSite: 'lax' | 'strict' | 'none'
  secure: boolean
  maxAge: number
}

// fallback secret：仅用于本地开发，生产必须配置 AUTH_SECRET
const FALLBACK_SECRET = 'holly-dev-only-secret-do-not-use-in-production-0000'

/**
 * 解析 AUTH_SECRET：模块加载时一次性求值并缓存（替代每次请求重算）。
 * - 生产环境（NODE_ENV=production）缺失或长度 < 32 → 抛错，拒绝不安全启动。
 *   本模块被 user-context 等路由间接导入，首个触及鉴权的请求即触发抛错，
 *   等效"不可用即拒绝"，杜绝用硬编码 fallback 签发可伪造 cookie。
 * - 开发环境保留 fallback + 告警，不影响本地体验。
 */
function resolveAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.length >= 32) return secret
  const reason = !secret ? '未配置' : '长度不足 32'
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[auth] AUTH_SECRET ${reason}，生产环境拒绝启动。请设置 AUTH_SECRET 环境变量（≥32 位随机字符串）。`,
    )
  }
  console.warn(`[auth] AUTH_SECRET ${reason}，使用不安全的 fallback（仅限开发环境）`)
  return FALLBACK_SECRET
}

const AUTH_SECRET = resolveAuthSecret()

/**
 * 对用户名生成 HMAC-SHA256 签名（十六进制）。
 */
export function sign(username: string): string {
  return crypto.createHmac('sha256', AUTH_SECRET).update(username).digest('hex')
}

/**
 * 校验用户名与签名是否匹配（恒定时间比较，防时序攻击）。
 */
export function verify(username: string, sig: string): boolean {
  if (!username || !sig) return false
  const expected = sign(username)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(sig, 'hex')
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// Cookie Secure 标志：默认 false（HTTP 直连部署可用）。
// HTTPS 反代部署时显式设 COOKIE_SECURE=true，cookie 仅经 HTTPS 传输。
// 不随 NODE_ENV 自动开启：Docker 部署 NODE_ENV=production 但常以 HTTP 直连，
// 若强制 Secure 会导致浏览器拒绝保存 cookie，登录后所有请求"未登录"。
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'

const baseCookieOptions: Omit<CookieOption, 'name' | 'value'> = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: COOKIE_SECURE,
  maxAge: MAX_AGE,
}

/**
 * 返回登录成功后需要设置的 cookie（holly_user + holly_sig）。
 */
export function createSessionCookies(username: string): CookieOption[] {
  const sig = sign(username)
  return [
    { name: COOKIE_USER, value: username, ...baseCookieOptions },
    { name: COOKIE_SIG, value: sig, ...baseCookieOptions },
  ]
}

/**
 * 返回登出时需要清除的 cookie（maxAge=0）。
 */
export function clearSessionCookies(): CookieOption[] {
  return [
    { name: COOKIE_USER, value: '', ...baseCookieOptions, maxAge: 0 },
    { name: COOKIE_SIG, value: '', ...baseCookieOptions, maxAge: 0 },
  ]
}

export interface SessionState {
  authenticated: boolean
  username: string | null
}

/**
 * 从请求 cookie 中校验会话。
 * holly_user 与 holly_sig 同时存在且签名匹配才算已登录。
 */
export function verifySession(request: NextRequest): SessionState {
  const username = request.cookies.get(COOKIE_USER)?.value
  const sig = request.cookies.get(COOKIE_SIG)?.value
  if (!username || !sig) return { authenticated: false, username: null }
  if (!verify(username, sig)) return { authenticated: false, username: null }
  return { authenticated: true, username }
}

const authApi = { sign, verify, createSessionCookies, clearSessionCookies, verifySession }
export default authApi
