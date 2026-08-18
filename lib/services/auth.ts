/**
 * 签名 cookie 鉴权
 *
 * 用 HMAC-SHA256 对 `username:sessionVersion` 签名，签发 holly_user + holly_sv + holly_sig 三个 cookie。
 * 替代原先可伪造的明文 holly_user cookie。
 *
 * sessionVersion（会话纪元）存于 User 表：改密码/管理员重置密码时 +1，
 * 旧 cookie 因签名与 DB 版本不符立即失效（见 user-context.getAuthState 的比对）。
 * 升级前签发的旧格式 cookie（无 holly_sv）按 version=0 兼容，部署后不强制全员重登。
 *
 * AUTH_SECRET 从环境变量读取；缺失时使用固定 fallback 并告警（仅开发环境可用）。
 */

import crypto from 'crypto'
import type { NextRequest } from 'next/server'

const COOKIE_USER = 'holly_user'
const COOKIE_SIG = 'holly_sig'
const COOKIE_SV = 'holly_sv'
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

// 惰性缓存：首次调用 getAuthSecret() 时求值一次并缓存。
// 不用模块顶层求值——next build 的 collecting page data 阶段会加载所有路由模块，
// 若顶层抛错会导致构建失败（AUTH_SECRET 是运行时配置，构建阶段不应强制要求）。
let cachedSecret: string | null = null

/**
 * 解析 AUTH_SECRET：首次使用时惰性求值并缓存（替代每次请求重算）。
 * - 生产环境（NODE_ENV=production）缺失或长度 < 32 → 抛错，拒绝不安全启动。
 *   首个触及鉴权的请求即触发抛错，等效"不可用即拒绝"，
 *   杜绝用硬编码 fallback 签发可伪造 cookie。
 * - 开发环境保留 fallback + 告警，不影响本地体验。
 */
function getAuthSecret(): string {
  if (cachedSecret) return cachedSecret
  const secret = process.env.AUTH_SECRET
  if (secret && secret.length >= 32) {
    cachedSecret = secret
    return secret
  }
  const reason = !secret ? '未配置' : '长度不足 32'
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[auth] AUTH_SECRET ${reason}，生产环境拒绝启动。请设置 AUTH_SECRET 环境变量（≥32 位随机字符串）。`,
    )
  }
  console.warn(`[auth] AUTH_SECRET ${reason}，使用不安全的 fallback（仅限开发环境）`)
  cachedSecret = FALLBACK_SECRET
  return FALLBACK_SECRET
}

/**
 * 对 `username:sessionVersion` 生成 HMAC-SHA256 签名（十六进制）。
 * version 为纯数字，用户名中即使含 ":" 也不会产生拼接歧义（version 从 cookie 独立解析，不回拆字符串）。
 */
export function sign(username: string, sessionVersion = 0): string {
  return crypto
    .createHmac('sha256', getAuthSecret())
    .update(`${username}:${sessionVersion}`)
    .digest('hex')
}

/**
 * 校验用户名、会话版本与签名是否匹配（恒定时间比较，防时序攻击）。
 */
export function verify(username: string, sig: string, sessionVersion = 0): boolean {
  if (!username || !sig) return false
  const expected = sign(username, sessionVersion)
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
 * 返回登录成功后需要设置的 cookie（holly_user + holly_sv + holly_sig）。
 * holly_sv 参与签名计算，客户端无法伪造有效版本号。
 */
export function createSessionCookies(username: string, sessionVersion = 0): CookieOption[] {
  const sig = sign(username, sessionVersion)
  return [
    { name: COOKIE_USER, value: username, ...baseCookieOptions },
    { name: COOKIE_SV, value: String(sessionVersion), ...baseCookieOptions },
    { name: COOKIE_SIG, value: sig, ...baseCookieOptions },
  ]
}

/**
 * 返回登出时需要清除的 cookie（maxAge=0）。
 */
export function clearSessionCookies(): CookieOption[] {
  return [
    { name: COOKIE_USER, value: '', ...baseCookieOptions, maxAge: 0 },
    { name: COOKIE_SV, value: '', ...baseCookieOptions, maxAge: 0 },
    { name: COOKIE_SIG, value: '', ...baseCookieOptions, maxAge: 0 },
  ]
}

export interface SessionState {
  authenticated: boolean
  username: string | null
  /** cookie 中携带的会话纪元（需与 User.sessionVersion 一致才算有效，比对在 user-context 完成） */
  sessionVersion: number
}

/**
 * 从请求 cookie 中校验会话。
 * holly_user 与 holly_sig 同时存在且签名匹配才算已登录。
 *
 * holly_sv 解析规则：
 * - 缺失 → 按 0 处理（升级前签发的旧格式 cookie 兼容，DB 默认值同为 0）
 * - 存在但非纯数字 → 判定未登录（异常值按伪造处理，拒绝而非回退）
 */
export function verifySession(request: NextRequest): SessionState {
  const username = request.cookies.get(COOKIE_USER)?.value
  const sig = request.cookies.get(COOKIE_SIG)?.value
  const svRaw = request.cookies.get(COOKIE_SV)?.value
  if (!username || !sig) return { authenticated: false, username: null, sessionVersion: 0 }
  const sessionVersion = svRaw === undefined ? 0 : parseSessionVersion(svRaw)
  if (sessionVersion === null) return { authenticated: false, username: null, sessionVersion: 0 }
  if (!verify(username, sig, sessionVersion)) {
    return { authenticated: false, username: null, sessionVersion: 0 }
  }
  return { authenticated: true, username, sessionVersion }
}

/** 解析 holly_sv：非负整数字符串合法，其余视为非法 */
function parseSessionVersion(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

const authApi = { sign, verify, createSessionCookies, clearSessionCookies, verifySession }
export default authApi
