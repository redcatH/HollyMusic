/**
 * 自助修改密码 API
 * POST /api/auth/change-password  body { currentPassword, newPassword }
 *
 * - 需已登录
 * - 校验当前密码（恒定时间比较）
 * - 新密码长度 ≥ 6，且与当前密码不同
 * - 改密成功后清除 mustChangePassword 标记
 * - 改密成功后 sessionVersion +1：其它设备的旧会话立即失效；
 *   当前设备重发新版本 cookie 保持登录态
 *
 * 注：本项目密码仍以明文存于 User.subsonicSecret（与 Subsonic t 校验兼容），
 * 此处仅做"改密"语义，不引入哈希以避免破坏 Subsonic 协议鉴权。
 */

import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser } from '@/lib/services/user-context'
import { createSessionCookies } from '@/lib/services/auth'
import { logger } from '@/lib/logger'
import { PrismaClient } from '@/lib/generated/prisma'

const prisma = new PrismaClient()

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
    const me = await requireUser(request)

    const body = await request.json().catch(() => ({}))
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

    if (!currentPassword || !newPassword) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '当前密码和新密码不能为空', 400)
    }
    if (newPassword.length < 6) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '新密码长度至少 6 位', 400)
    }

    const user = await prisma.user.findUnique({ where: { id: me.id } })
    if (!user || !user.subsonicSecret || !safeEqual(user.subsonicSecret, currentPassword)) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '当前密码错误', 401)
    }
    if (safeEqual(user.subsonicSecret, newPassword)) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '新密码不能与当前密码相同', 400)
    }

    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { subsonicSecret: newPassword, mustChangePassword: false, sessionVersion: { increment: 1 } },
    })

    logger.info(`[auth/change-password] 用户修改密码成功: ${me.username} (sessionVersion → ${updated.sessionVersion})`)

    // 重发当前设备会话 cookie（携带新版本）：本设备不掉线，其它设备旧 cookie 因版本不匹配全部失效
    const res = createSuccessResponse({ ok: true })
    for (const c of createSessionCookies(me.username, updated.sessionVersion)) {
      res.cookies.set(c.name, c.value, c)
    }
    return res
  } catch (err) {
    const e = err as { statusCode?: number; message?: string }
    if (e?.statusCode === 401) {
      return createErrorResponse('UNAUTHORIZED', e.message || '未登录', 401)
    }
    logger.error('[api/auth/change-password] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '修改密码失败', 500)
  }
}
