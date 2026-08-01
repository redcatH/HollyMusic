/**
 * 音频流 serve API（服务端磁盘缓存 + 边下边播 + Range 支持）
 *
 * GET  /api/audio?uid=<source-songmid>&quality=<quality>
 *      Range 请求由 lib/server/audio-cache 处理：
 *      - 命中完整缓存 → 直接按 Range 读文件（206）
 *      - 边下边播 → 等水位线后从 .tmp 读（206）
 *      - 无 Content-Length → 透传上游
 * HEAD /api/audio?... → 同 GET 但不带 body，供 <audio> 探测
 *
 * uid 格式：`${source}-${存储songmid}`，与 resolveMusicInfoById 一致。
 */

import { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { resolveMusicInfoById } from '@/lib/db'
import { musicSourceManager } from '@/lib/music-source-manager'
import type { QualityType } from '@/lib/types/music'
import { ensureInitialized, serve } from '@/lib/server/audio-cache'

function buildErrorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

async function handleAudio(request: NextRequest, isHead: boolean): Promise<Response> {
  try {
    await ensureInitialized()

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

    // 缓存键（与 urlCache 键一致）
    const cacheKey = `audio:${musicInfo.source}:${musicInfo.songmid}:${quality}`

    // 获取上游真实 URL（含音质降级逻辑）
    if (!musicSourceManager.isInitialized()) {
      await musicSourceManager.initialize()
    }
    const upstreamUrl = await musicSourceManager.getMusicUrl(musicInfo, quality)

    const rangeHeader = request.headers.get('range')

    return await serve({
      cacheKey,
      upstreamUrl,
      quality,
      uid,
      rangeHeader,
      isHead,
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
