/**
 * 登录锁定管理 API（仅管理员）
 * GET  /api/admin/login-locks          列出当前锁定中的 IP
 * POST /api/admin/login-locks          { action: 'unlock'|'clearAll', ip?: string }
 *
 * 用于后台查看因登录失败次数过多被锁定的 IP，并手动解锁。
 * 锁定状态存进程内存，重启即清空。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { listLockedIps, unlockIp, clearAllLocks } from '@/lib/server/login-rate-limit'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

/** GET：列出当前锁定中的 IP */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const locks = listLockedIps()
    return createSuccessResponse({ locks, count: locks.length })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/login-locks GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取登录锁定列表失败', 500)
  }
}

/** POST：解锁指定 IP 或清空全部锁定 */
export async function POST(request: NextRequest) {
  try {
    const me = await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const { action, ip } = body as { action?: 'unlock' | 'clearAll'; ip?: string }

    if (action === 'unlock') {
      if (!ip || typeof ip !== 'string') {
        return createErrorResponse('INVALID_PARAMS', '解锁需要提供 ip', 400)
      }
      const unlocked = unlockIp(ip.trim())
      logger.info(`[admin/login-locks] ${me.username} 解锁 IP ${ip.trim()}: ${unlocked ? '成功' : '未找到锁定'}`)
      return createSuccessResponse({ ip: ip.trim(), unlocked })
    }

    if (action === 'clearAll') {
      const count = clearAllLocks()
      logger.info(`[admin/login-locks] ${me.username} 清空全部登录锁定: ${count} 个`)
      return createSuccessResponse({ cleared: count })
    }

    return createErrorResponse('INVALID_PARAMS', 'action 必须为 unlock 或 clearAll', 400)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/login-locks POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '解锁操作失败', 500)
  }
}
