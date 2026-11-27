/**
 * 音频流 serve API（2026-08 重构版）。
 *
 * 设计：URL 解析惰性化——只在「真正 miss」时调用一次上游，由 audioServe 内部进行中去重。
 * 已缓存的请求完全不触发 URL 解析。
 *
 * GET  /api/audio?uid=<source-songmid>&quality=<quality>
 *      - 已完整缓存 → 本地文件 Range（任意 seek，0 次上游调用）
 *      - 进行中 → attach 到内存 entry（0 次上游调用）
 *      - miss → fetch 上游一次（多用户并发也只 1 次）
 *      - seek 超出已下载 → 等待 15s → 超时 503 + Retry-After
 *
 * HEAD /api/audio?... → 同 GET 但不带 body，供 <audio> 探测
 *
 * uid 格式：`${source}-${存储songmid}`，与 resolveMusicInfoById 一致。
 */

import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { resolveMusicInfoById } from '@/lib/db'
import { PLAYBACK_ERROR_HEADER, PLAYBACK_REQUEST_ID_HEADER } from '@/lib/playback-protocol'
import { isQuality } from '@/lib/quality-options'
import { serveMusicAudio } from '@/lib/server/music-audio'
import { describePlaybackError } from '@/lib/server/playback-diagnostics'

async function handleAudio(request: NextRequest, isHead: boolean): Promise<Response> {
  const requestId = randomUUID()
  const { searchParams } = new URL(request.url)
  const uid = searchParams.get('uid')
  const quality = searchParams.get('quality') || '320k'
  const logContext = { requestId, method: request.method, uid: uid?.slice(0, 146), quality: isQuality(quality) ? quality : undefined }

  function fail(status: number, code: string, message: string, error?: unknown): Response {
    logger.warn('[/api/audio] 请求失败', { ...logContext, status, code, message,
      cause: error === undefined ? undefined : describePlaybackError(error) })
    return new Response(isHead ? null : JSON.stringify({ success: false, error: { code, message, requestId } }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        [PLAYBACK_REQUEST_ID_HEADER]: requestId,
        [PLAYBACK_ERROR_HEADER]: code,
      },
    })
  }

  try {
    if (!uid) {
      return fail(400, 'INVALID_PARAMS', '缺少必填参数: uid')
    }

    if (!isQuality(quality)) {
      return fail(400, 'QUALITY_NOT_SUPPORTED', '不支持所选音质')
    }

    // 从 DB 解析 uid → MusicInfo（search 时已 upsert，正常流程都有）
    const musicInfo = await resolveMusicInfoById(uid)
    if (!musicInfo) {
      return fail(404, 'NOT_FOUND', '找不到歌曲信息')
    }

    return await serveMusicAudio({
      musicInfo, quality, isHead, requestId,
      exact: searchParams.get('exact') === '1',
      surround: searchParams.get('surround') === '1',
      rangeHeader: request.headers.get('range'),
    })
  } catch (error) {
    return fail(500, 'AUDIO_SERVE_FAILED', '音频服务请求失败', error)
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleAudio(request, false)
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleAudio(request, true)
}
