/**
 * 登录 API
 * POST /api/auth/login  body { username, password }
 *
 * 校验 DB User.subsonicSecret（= config/users.json 的 password），
 * 成功则签发 holly_user + holly_sig 签名 cookie，并记录登录活动（lastLogin + 最近活跃 IP/UA）。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { createSessionCookies } from '@/lib/services/auth'
import { logger } from '@/lib/logger'
import { PrismaClient } from '@/lib/generated/prisma'
import { updateLastLoginByUsername, updateLastSeenByUsername, getClientIp, getUa } from '@/lib/user'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!username || !password) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '用户名和密码不能为空', 400)
    }

    const user = await prisma.user.findUnique({ where: { username } })
    // 无论用户是否存在，都返回相同的错误信息，避免用户名枚举
    if (!user || !user.subsonicSecret || user.subsonicSecret !== password) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '用户名或密码错误', 401)
    }

    // 签发签名 cookie
    const cookies = createSessionCookies(username)
    const res = createSuccessResponse({ user: { username } })
    for (const c of cookies) {
      res.cookies.set(c.name, c.value, c)
    }

    // best-effort 记录登录活动：lastLogin + 最近活跃(IP/UA)，登录即在线
    try { await updateLastLoginByUsername(username) } catch {}
    try { await updateLastSeenByUsername(username, getClientIp(request), getUa(request)) } catch {}

    logger.info(`[auth/login] 用户登录成功: ${username}`)
    return res
  } catch (err) {
    logger.error('[api/auth/login] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '登录失败', 500)
  }
}
