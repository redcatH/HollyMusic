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

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.length >= 32) return secret
  if (!secret) {
    console.warn('[auth] AUTH_SECRET 未配置，使用不安全的 fallback（仅限开发环境）')
  } else {
    console.warn('[auth] AUTH_SECRET 长度不足 32，建议使用更长的随机值')
  }
  return FALLBACK_SECRET
}

/**
 * 对用户名生成 HMAC-SHA256 签名（十六进制）。
 */
export function sign(username: string): string {
  return crypto.createHmac('sha256', getAuthSecret()).update(username).digest('hex')
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

const baseCookieOptions: Omit<CookieOption, 'name' | 'value'> = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
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
