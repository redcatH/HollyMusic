/**
 * 启用音源列表 API（所有登录用户）
 * GET /api/search-sources
 *
 * 返回当前启用的搜索平台列表（来自 config/music-sources.json，getSearchSources()）。
 * 供前端「只搜启用源」使用，避免向未启用音源发起无效请求。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { getSearchSources } from '@/lib/search-config'

export async function GET(request: NextRequest) {
  try {
    await requireUser(request)
    return createSuccessResponse({ sources: getSearchSources() })
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    return createErrorResponse('INTERNAL_ERROR', '读取音源配置失败', 500)
  }
}
