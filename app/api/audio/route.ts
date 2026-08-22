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

import { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { resolveMusicInfoById } from '@/lib/db'
import { musicSourceManager } from '@/lib/music-source-manager'
import type { QualityType } from '@/lib/types/music'
import { parseIntervalToSeconds } from '@/lib/types/player'
import { audioServe } from '@/lib/audio-serve'
import { cacheNativeLyricForMusic } from '@/lib/services/lyrics'

function buildErrorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

async function handleAudio(request: NextRequest, isHead: boolean): Promise<Response> {
  try {
    await audioServe.ensureInitialized()

    const { searchParams } = new URL(request.url)
    const uid = searchParams.get('uid')
    const quality = (searchParams.get('quality') || '320k') as QualityType

    if (!uid) {
      return buildErrorResponse(400, 'INVALID_PARAMS', '缺少必填参数: uid')
    }

    const validQualities: QualityType[] = ['128k', '320k', 'flac', 'flac24bit']
    if (!validQualities.includes(quality)) {
      return buildErrorResponse(400, 'QUALITY_NOT_SUPPORTED', `不支持的音质: ${quality}`)
    }

    // 从 DB 解析 uid → MusicInfo（search 时已 upsert，正常流程都有）
    const musicInfo = await resolveMusicInfoById(uid)
    if (!musicInfo) {
      return buildErrorResponse(404, 'NOT_FOUND', `找不到歌曲信息: ${uid}`)
    }

    const cacheKey = `${musicInfo.source}:${musicInfo.songmid}:${quality}`

    // URL resolver 下沉到 audioServe 内部：只在真正 miss 时调用一次。
    // 已缓存 / 进行中的请求完全不触发 URL 解析（解决重复打上游问题）。
    const upstreamUrlResolver = async (): Promise<string> => {
      if (!musicSourceManager.isInitialized()) {
        await musicSourceManager.initialize()
      }
      return musicSourceManager.getMusicUrl(musicInfo, quality)
    }

    const rangeHeader = request.headers.get('range')

    return await audioServe.serve({
      cacheKey,
      upstreamUrlResolver,
      rangeHeader,
      isHead,
      intervalSec: parseIntervalToSeconds(musicInfo.interval),
      onCached: () => cacheNativeLyricForMusic(musicInfo),
    })
  } catch (error) {
    logger.error('[/api/audio] 失败:', error)
    const message = error instanceof Error ? error.message : '音频 serve 失败'
    const status = message.includes('无法获取播放链接') ? 502 : 500
    return buildErrorResponse(status, 'AUDIO_SERVE_FAILED', message)
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleAudio(request, false)
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleAudio(request, true)
}
