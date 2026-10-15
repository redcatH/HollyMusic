import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { createSessionCookies } from '@/lib/services/auth'
import { completeInitialization, SetupError, validateInitialPassword } from '@/lib/services/initialization'
import { checkLoginRate, recordLoginFailure, resetLoginRate } from '@/lib/server/login-rate-limit'

const RATE_KEY = 'setup:instance'

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host') || new URL(request.url).host
    let validOrigin = !origin
    if (origin) {
      try {
        const parsed = new URL(origin)
        validOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === host
      } catch { /* 无效 Origin 按跨站请求拒绝。 */ }
    }
    if (request.headers.get('sec-fetch-site') === 'cross-site' ||
      !validOrigin) {
      return createErrorResponse('FORBIDDEN', '请在本站页面完成初始化', 403)
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return createErrorResponse('INVALID_PARAMS', '请求格式无效', 415)
    }
    const rate = checkLoginRate(RATE_KEY)
    if (!rate.allowed) {
      const response = createErrorResponse('RATE_LIMITED', '尝试过于频繁，请稍后重试', 429)
      response.headers.set('Retry-After', String(rate.retryAfterSec))
      return response
    }
    if (Number(request.headers.get('content-length')) > 4096) {
      return createErrorResponse('INVALID_PARAMS', '请求内容过长', 413)
    }
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 4096) return createErrorResponse('INVALID_PARAMS', '请求内容过长', 413)
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body')
      body = parsed as Record<string, unknown>
    } catch {
      return createErrorResponse('INVALID_PARAMS', '请求内容无效', 400)
    }
    const expectedToken = process.env.SETUP_TOKEN
    if (expectedToken) {
      const token = typeof body.setupToken === 'string' ? body.setupToken : ''
      const expected = crypto.createHash('sha256').update(expectedToken).digest()
      const actual = crypto.createHash('sha256').update(token).digest()
      if (!crypto.timingSafeEqual(expected, actual)) {
        recordLoginFailure(RATE_KEY)
        return createErrorResponse('FORBIDDEN', '初始化码不正确', 403)
      }
    }
    validateInitialPassword(body.password, body.confirmPassword)
    // 先验证签名配置，避免账户已创建但生产 AUTH_SECRET 不可用而无法登录。
    const cookies = createSessionCookies('admin', 0)
    const user = await completeInitialization(body.password)
    resetLoginRate(RATE_KEY)
    const response = createSuccessResponse({ user: { username: user.username, mustChangePassword: false } }, 201)
    cookies.forEach(cookie => response.cookies.set(cookie.name, cookie.value, cookie))
    response.headers.set('Cache-Control', 'no-store')
    logger.info('[setup] 管理员完成首次初始化')
    return response
  } catch (error) {
    if (error instanceof SetupError) {
      if (error.statusCode === 400) recordLoginFailure(RATE_KEY)
      return createErrorResponse('SETUP_ERROR', error.message, error.statusCode)
    }
    // 数据库异常可能包含写入参数，不能把完整异常（含密码）写入日志。
    logger.error('[setup] 初始化失败:', { code: (error as { code?: string })?.code ?? 'UNKNOWN' })
    return createErrorResponse('INTERNAL_ERROR', '暂时无法完成设置，请检查服务配置后重试', 503)
  }
}
