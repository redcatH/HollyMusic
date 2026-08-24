/**
 * 图片代理 API
 * GET /api/image-proxy?url=<远程图片URL> → 返回图片二进制
 *
 * 背景：腾讯 y.gtimg.cn 等平台图片域名命中浏览器广告拦截/跟踪防护规则
 * （ERR_BLOCKED_BY_CLIENT），前端直连会静默失败；改走同源代理绕开客户端拦截。
 * 安全：仅允许音乐平台图片域名白名单（同时天然杜绝 SSRF），响应超时与大小受限，
 * 字节缓存复用 searchCache 单例（TTL 60 分钟），并输出 Cache-Control 供浏览器复用。
 */

import { NextRequest } from 'next/server'
import { searchCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'

const ALLOWED_HOST_SUFFIXES = [
  'gtimg.cn', // QQ 图片 CDN（y.gtimg.cn / imgcache.gtimg.cn 等）
  'qpic.cn', // QQ 歌单封面（p.qpic.cn）
  'qpic.y.qq.com', // QQ 歌单封面另一域名族（生产实测）
  'music.126.net', // 网易云
  'kuwo.cn', // 酷我
  'kugou.com', 'kgimg.com', // 酷狗
  'migu.cn', // 咪咕
]

const CACHE_TTL = 60 * 60 * 1000
const MAX_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT = 8_000

type CachedImage = { bytes: Uint8Array<ArrayBuffer>; contentType: string }

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url') || ''
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return new Response('invalid url', { status: 400 })
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !isAllowedHost(parsed.hostname)) {
    return new Response('host not allowed', { status: 403 })
  }

  const cacheKey = `image-proxy:v1:${rawUrl}`
  const cached = searchCache.get(cacheKey) as CachedImage | null
  if (cached) return toImageResponse(cached)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const upstream = await fetch(parsed, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: `${parsed.protocol}//${parsed.hostname}/` },
      signal: controller.signal,
    })
    if (!upstream.ok) return new Response('upstream error', { status: 502 })

    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      // 平台偶发返回错误页/跳转页，不能当图片下发
      return new Response('not an image', { status: 502 })
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return new Response('image size out of range', { status: 502 })
    }

    const image: CachedImage = { bytes, contentType }
    searchCache.set(cacheKey, image, CACHE_TTL)
    return toImageResponse(image)
  } catch (error) {
    logger.warn('[api/image-proxy] fetch failed:', rawUrl.slice(0, 100), error)
    return new Response('fetch failed', { status: 502 })
  } finally {
    clearTimeout(timeoutId)
  }
}

function toImageResponse(image: CachedImage): Response {
  return new Response(image.bytes, {
    headers: {
      'Content-Type': image.contentType,
      // 封面低频变化，允许浏览器缓存一天，避免重复打代理
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
