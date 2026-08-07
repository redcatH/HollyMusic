/**
 * 登录 API
 * POST /api/auth/login  body { username, password }
 *
 * 校验 DB User.subsonicSecret（= config/users.json 的 password），
 * 成功则签发 holly_user + holly_sig 签名 cookie，并记录登录活动（lastLogin + 最近活跃 IP/UA）。
 *
 * 安全策略：
 * - 按 IP 维度登录限速：5 分钟内失败 10 次锁定该 IP 15 分钟
 * - 密码校验用恒定时间比较，防时序攻击
 * - 返回 mustChangePassword 标记，前端据此强制引导改密
 */

import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { createSessionCookies } from '@/lib/services/auth'
import { logger } from '@/lib/logger'
import { PrismaClient } from '@/lib/generated/prisma'
import { updateLastLoginByUsername, updateLastSeenByUsername, getClientIp, getUa } from '@/lib/user'
import { checkLoginRate, recordLoginFailure, resetLoginRate } from '@/lib/server/login-rate-limit'

const prisma = new PrismaClient()

/** 恒定时间字符串比较，防时序攻击 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  try {
    return crypto.timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request) || 'unknown'

    // 1. 限速检查：锁定中的 IP 直接拒绝
    const rateCheck = checkLoginRate(clientIp)
    if (!rateCheck.allowed) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        `登录尝试过于频繁，请 ${rateCheck.retryAfterSec} 秒后再试`,
        429,
      )
    }

    const body = await request.json().catch(() => ({}))
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!username || !password) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '用户名和密码不能为空', 400)
    }

    const user = await prisma.user.findUnique({ where: { username } })

    // 无论用户是否存在，都返回相同的错误信息，避免用户名枚举；
    // 用户不存在时也执行一次 dummy 比较，统一耗时
    const storedSecret = user?.subsonicSecret ?? ''
    const ok = user && storedSecret
      ? safeEqual(storedSecret, password)
      : safeEqual('x'.repeat(32), 'y'.repeat(32))

    if (!user || !storedSecret || !ok) {
      // 记录失败，达阈值则锁定
      const failCheck = recordLoginFailure(clientIp)
      if (!failCheck.allowed) {
        return createErrorResponse(
          ErrorCodes.INVALID_PARAMS,
          `登录失败次数过多，IP 已锁定 ${failCheck.retryAfterSec} 秒`,
          429,
        )
      }
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '用户名或密码错误', 401)
    }

    // 2. 登录成功：清空该 IP 的失败计数
    resetLoginRate(clientIp)

    // 3. 签发签名 cookie
    const cookies = createSessionCookies(username)
    const res = createSuccessResponse({
      user: { username, mustChangePassword: !!user.mustChangePassword },
    })
    for (const c of cookies) {
      res.cookies.set(c.name, c.value, c)
    }

    // best-effort 记录登录活动：lastLogin + 最近活跃(IP/UA)，登录即在线
    try { await updateLastLoginByUsername(username) } catch {}
    try { await updateLastSeenByUsername(username, clientIp, getUa(request)) } catch {}

    logger.info(`[auth/login] 用户登录成功: ${username}`)
    return res
  } catch (err) {
    logger.error('[api/auth/login] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '登录失败', 500)
  }
}
