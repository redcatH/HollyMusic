import { NextRequest, NextResponse } from 'next/server'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { logger } from '@/lib/logger'
import { resolveMusicInfoById } from '@/lib/db'
import { musicSourceManager } from '@/lib/music-source-manager'
import { audioServe } from '@/lib/audio-serve'
import type { QualityType } from '@/lib/types/music'
import {
  isValidUrl,
  extractDomain,
  isAllowedDomain,
  getAllowedDomainsFromEnv,
  sanitizeFilename,
  buildUpstreamHeaders,
  buildContentDisposition,
  buildFilenameFromMusicInfo,
} from '@/lib/server/download-utils'

/**
 * 音乐下载代理路由
 *
 * 两种模式：
 *
 * 1. uid 模式（推荐，与播放 /api/audio 一致，复用磁盘缓存）：
 *    GET /api/download?uid=<source-songmid>&quality=<quality>
 *    - requireUser 鉴权
 *    - resolveMusicInfoById(uid) 从 DB 解析 MusicInfo
 *    - 后端用 buildFilenameFromMusicInfo 组装文件名（不接收前端 filename，安全）
 *    - audioServe.serve({ cacheKey, upstreamUrlResolver, ... })
 *      · 缓存命中（播放过）→ 磁盘读，0 回源
 *      · 缓存 miss → 回源一次 + 边下边落盘（下次命中）
 *    - 注入 Content-Disposition: attachment
 *
 * 2. url 模式（兼容直链下载，不缓存）：
 *    GET /api/download?url=<encoded>&filename=<name>
 *    - requireUser 鉴权
 *    - 直接流式代理上游，加 Content-Disposition（filename 由前端提供 + sanitize）
 *
 * 鉴权：受 requireUser 保护，未登录返回 401。
 */

// ============================================================================
// 配置常量
// ============================================================================

/** url 模式：单文件大小上限（字节），默认 500MB */
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

/** url 模式：回源 fetch 超时（毫秒） */
const UPSTREAM_TIMEOUT_MS = 30_000

// ============================================================================
// 域名白名单（url 模式用；默认放行所有，环境变量配置后生效）
// ============================================================================

function getAllowedDownloadDomains(): string[] {
  const fromEnv = getAllowedDomainsFromEnv()
  return fromEnv.length > 0 ? fromEnv : ['*']
}

// ============================================================================
// uid 模式：复用 AudioServe 磁盘缓存
// ============================================================================

async function handleDownloadByUid(
  uid: string,
  quality: QualityType,
  clientIP: string
): Promise<NextResponse> {
  // 1. 从 DB 解析 uid → MusicInfo（搜索时已 upsert，正常流程都有）
  const musicInfo = await resolveMusicInfoById(uid)
  if (!musicInfo) {
    logger.warn(`[download] uid 未找到: ${uid} ip=${clientIP}`)
    return NextResponse.json(
      { error: `找不到歌曲信息: ${uid}` },
      { status: 404 }
    )
  }

  // 2. cacheKey 与 /api/audio 完全一致，确保命中同一份磁盘缓存
  const cacheKey = `${musicInfo.source}:${musicInfo.songmid}:${quality}`

  // 3. upstreamUrlResolver：只在 cache miss 时调用一次（audioServe 内部去重）
  const upstreamUrlResolver = async (): Promise<string> => {
    if (!musicSourceManager.isInitialized()) {
      await musicSourceManager.initialize()
    }
    return musicSourceManager.getMusicUrl(musicInfo, quality)
  }

  // 4. 确保 audioServe 已初始化（创建缓存目录等）
  await audioServe.ensureInitialized()

  // 5. 委托 audioServe（缓存命中 → 磁盘读；miss → 回源 + 边下边落盘）
  //    下载场景不发 Range（浏览器 window.location.href 默认无 Range），audioServe 返回完整文件
  const rangeHeader = null
  const audioResp = await audioServe.serve({
    cacheKey,
    upstreamUrlResolver,
    rangeHeader,
    isHead: false,
  })

  // 6. audioServe 错误响应（502/503）直接透传
  if (!audioResp.ok) {
    logger.warn(
      `[download] audioServe 返回 ${audioResp.status} uid=${uid} cacheKey=${cacheKey} ip=${clientIP}`
    )
    return new NextResponse(audioResp.body, {
      status: audioResp.status,
      headers: audioResp.headers,
    })
  }

  // 7. 后端组装文件名（不信任前端输入，从 DB MusicInfo 构造）+
  //    注入 Content-Disposition: attachment（复制 audioServe 的头 + 追加）
  //    非侵入式：不改 audio-serve.ts，仅在外层包装
  const finalFilename = sanitizeFilename(buildFilenameFromMusicInfo(musicInfo, quality))
  const headers = new Headers(audioResp.headers)
  headers.set('Content-Disposition', buildContentDisposition(finalFilename))

  logger.info(
    `[download] ok uid=${uid} cacheKey=${cacheKey} ip=${clientIP} status=${audioResp.status}`
  )

  return new NextResponse(audioResp.body, {
    status: audioResp.status,
    headers,
  })
}

// ============================================================================
// url 模式：直接流式代理（不缓存，兼容直链场景）
// ============================================================================

async function handleDownloadByUrl(
  url: string,
  filename: string | null,
  clientIP: string
): Promise<NextResponse> {
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: '无效的 URL' }, { status: 400 })
  }

  const domain = extractDomain(url)
  const allowed = getAllowedDownloadDomains()
  if (!domain || !isAllowedDomain(domain, allowed)) {
    logger.warn(`[download] 域名被拒: ${domain} | ip=${clientIP}`)
    return NextResponse.json({ error: '不支持的下载域名' }, { status: 403 })
  }

  const upstreamHeaders = buildUpstreamHeaders(url)
  let remoteResponse: Response
  try {
    remoteResponse = await fetch(url, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (e) {
    const err = e as Error
    const isTimeout =
      err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      (err.message?.includes('aborted') ?? false)
    if (isTimeout) {
      logger.error(`[download] 回源超时 url=${url} ip=${clientIP}:`, err.message)
      return NextResponse.json({ error: '下载超时' }, { status: 504 })
    }
    logger.error(`[download] 回源网络错误 url=${url} ip=${clientIP}:`, err.message)
    return NextResponse.json({ error: '下载源不可用' }, { status: 502 })
  }

  if (!remoteResponse.ok) {
    logger.warn(`[download] 远端返回 ${remoteResponse.status} url=${url} ip=${clientIP}`)
    return NextResponse.json(
      { error: `远端服务器错误: ${remoteResponse.status}` },
      { status: remoteResponse.status }
    )
  }

  const contentLength = remoteResponse.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
    logger.warn(
      `[download] 文件超限 ${contentLength} bytes > ${MAX_FILE_SIZE_BYTES} url=${url} ip=${clientIP}`
    )
    return NextResponse.json({ error: '文件过大' }, { status: 413 })
  }

  const contentType = remoteResponse.headers.get('content-type') || 'application/octet-stream'
  const finalFilename = sanitizeFilename(filename || 'download.mp3')

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Content-Disposition', buildContentDisposition(finalFilename))

  logger.info(
    `[download] ok(url) url=${url} ip=${clientIP} status=${remoteResponse.status} type=${contentType}`
  )

  return new NextResponse(remoteResponse.body, {
    status: remoteResponse.status,
    headers,
  })
}

// ============================================================================
// 客户端 IP
// ============================================================================

function getClientIP(request: NextRequest): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ip = (request as any).ip ?? request.headers.get('x-forwarded-for') ?? 'unknown'
  return typeof ip === 'string' ? ip.split(',')[0].trim() : 'unknown'
}

// ============================================================================
// GET handler（两种模式分流）
// ============================================================================

const VALID_QUALITIES: QualityType[] = ['128k', '320k', 'flac', 'flac24bit']

export async function GET(request: NextRequest) {
  try {
    await requireUser(request)

    const { searchParams } = new URL(request.url)
    const uid = searchParams.get('uid')
    const urlParam = searchParams.get('url')
    const filename = searchParams.get('filename')
    const clientIP = getClientIP(request)

    // uid 模式（推荐）：filename 后端组装，不读取前端传入
    if (uid) {
      const quality = (searchParams.get('quality') || '320k') as QualityType
      if (!VALID_QUALITIES.includes(quality)) {
        return NextResponse.json(
          { error: `不支持的音质: ${quality}` },
          { status: 400 }
        )
      }
      return await handleDownloadByUid(uid, quality, clientIP)
    }

    // url 模式（兼容）：filename 必须由前端提供
    if (urlParam) {
      let url: string
      try {
        url = decodeURIComponent(urlParam)
      } catch {
        return NextResponse.json({ error: '无效的 URL 编码' }, { status: 400 })
      }
      return await handleDownloadByUrl(url, filename, clientIP)
    }

    return NextResponse.json(
      { error: '缺少参数：需提供 uid 或 url' },
      { status: 400 }
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    logger.error('[download] GET 未预期错误:', error)
    return NextResponse.json({ error: '下载失败' }, { status: 500 })
  }
}

/**
 * POST /api/download  body: { url: string, filename?: string }
 * 保留 POST url 模式兼容（uid 模式只用 GET，因为 window.location.href 只能 GET）。
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser(request)

    const body = await request.json()
    const { url, filename } = body as { url?: string; filename?: string }

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '缺少或无效的 url 参数' }, { status: 400 })
    }

    return await handleDownloadByUrl(url, filename ?? null, getClientIP(request))
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    logger.error('[download] POST 未预期错误:', error)
    return NextResponse.json({ error: '下载失败' }, { status: 500 })
  }
}
