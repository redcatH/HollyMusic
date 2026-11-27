/**
 * 曲目元数据 API
 * GET /api/track?uid=<source-songmid>
 * POST /api/track { uids } 批量查询歌曲可用音质
 *
 * 分享链接 ?uid= 自动播放用：从 DB 反查 MusicInfo，前端 toTrack 后播放。
 * 复用 resolveMusicInfoById（与 /api/audio 同一反查路径）。
 *
 * 需登录（requireUser），未登录返回 401。未登录的分享访客由落地页承接，
 * 到达 SPA 时已被全局守卫拦截到登录页。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { resolveMusicInfoById } from '@/lib/db'
import { TRACK_QUALITY_BATCH_SIZE } from '@/lib/platform-qualities'
import { enrichAudioDetails } from '@/lib/server/platform-audio-details'
import { RateLimiter } from '@/lib/server/download-utils'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { logger } from '@/lib/logger'

const qualityLookupLimiter = new RateLimiter(60_000, 90)

export async function GET(request: NextRequest) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const uid = new URL(request.url).searchParams.get('uid')
    if (!uid) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: uid', 400)
    }

    const musicInfo = await resolveMusicInfoById(uid)
    if (!musicInfo) {
      return createErrorResponse('NOT_FOUND', `找不到歌曲信息: ${uid}`, 404)
    }

    return createSuccessResponse({ uid, musicInfo })
  } catch (error) {
    if (error instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', error.message, 401)
    }
    logger.error('[api/track] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取曲目信息失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    if (!qualityLookupLimiter.check(user.username)) {
      return createErrorResponse('RATE_LIMITED', '歌曲音质查询过于频繁', 429)
    }
    const body = await request.json().catch(() => null)
    const uids: unknown = body?.uids
    if (!Array.isArray(uids) || uids.length < 1 || uids.length > TRACK_QUALITY_BATCH_SIZE
      || !uids.every(uid => typeof uid === 'string' && /^(?:tx|wy|kg|kw|mg)-[\w-]{1,128}$/.test(uid))) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '歌曲 ID 或批量大小无效', 400)
    }

    const results = await Promise.all([...new Set<string>(uids)].map(async uid => {
      const musicInfo = await resolveMusicInfoById(uid)
      return [uid, musicInfo ? (await enrichAudioDetails(musicInfo)).types ?? [] : []] as const
    }))
    return createSuccessResponse(Object.fromEntries(results))
  } catch (error) {
    if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
    logger.error('[api/track POST] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '查询歌曲音质失败', 500)
  }
}
