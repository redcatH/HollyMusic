import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { SiteSettingsError } from '@/lib/site-settings'
import { getSiteSettings, updateSiteSettings } from '@/lib/services/site-settings'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'

function failure(error: unknown) {
  if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
  if (error instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', error.message, 403)
  if (error instanceof SiteSettingsError || error instanceof SyntaxError) {
    return createErrorResponse('INVALID_PARAMS', error instanceof SyntaxError ? '请求内容不是有效 JSON' : error.message, 400)
  }
  logger.error('[admin/site-settings] 站点设置操作失败:', error)
  return createErrorResponse('INTERNAL_ERROR', '暂时无法处理站点设置，请稍后重试', 503)
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const response = createSuccessResponse(await getSiteSettings())
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) { return failure(error) }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request)
    const origin = request.headers.get('origin')
    const host = request.headers.get('host') || request.nextUrl.host
    let validOrigin = !origin
    if (origin) {
      try { const url = new URL(origin); validOrigin = ['http:', 'https:'].includes(url.protocol) && url.host === host }
      catch { /* 拒绝无效 Origin。 */ }
    }
    if (!validOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return createErrorResponse('FORBIDDEN', '请在本站页面修改设置', 403)
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return createErrorResponse('INVALID_PARAMS', '请求格式必须为 JSON', 415)
    }
    if (Number(request.headers.get('content-length')) > 4096) {
      return createErrorResponse('INVALID_PARAMS', '请求内容过长', 413)
    }
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 4096) return createErrorResponse('INVALID_PARAMS', '请求内容过长', 413)
    const value: unknown = JSON.parse(raw)
    const response = createSuccessResponse(await updateSiteSettings(value))
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) { return failure(error) }
}
