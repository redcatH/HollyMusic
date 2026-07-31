/**
 * 播放历史 API
 * GET    /api/history?limit=&offset=   历史列表
 * POST   /api/history  body {musicInfo} 上报播放
 * DELETE /api/history                  清空历史
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { reportPlay, listHistory, clearHistory } from '@/lib/services/history-service'
import { logger } from '@/lib/logger'
import type { MusicInfo } from '@/lib/types/music'

function authGuard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  return null
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100')
    const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0')
    const data = await listHistory(user.username, { limit, offset })
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/history GET] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取历史失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const body = await request.json().catch(() => ({}))
    const musicInfo = body?.musicInfo as MusicInfo | undefined
    if (!musicInfo || !musicInfo.source || !musicInfo.songmid) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少 musicInfo', 400)
    }
    await reportPlay(user.username, musicInfo)
    return createSuccessResponse({ reported: true })
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/history POST] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '上报历史失败', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const data = await clearHistory(user.username)
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/history DELETE] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '清空历史失败', 500)
  }
}
