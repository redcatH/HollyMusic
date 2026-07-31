/**
 * 封面 service
 *
 * 独立实现（不依赖 lib/subsonic-*.ts），复用原生封面模块 music-core/music-pic
 * 与 db.resolveMusicInfoById。逻辑与 subsonic-metadata.ts 的 handleCoverArtAsync 一致。
 */

import { resolve } from 'path'
import { readFileSync } from 'fs'
import * as dbAPI from '../db'
import { logger } from '../logger'

// 原生封面获取模块（参考 lx-music 各源 pic 实现）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getPic: getPicNative } = require('../music-core/music-pic')

/**
 * 获取指定歌曲的封面图响应。
 * id 为 source-{存储songmid}；查 DB → 原生模块取封面 URL → 抓取图片；失败回退默认图。
 */
export async function getCoverResponse(id: string): Promise<Response> {
  try {
    if (!id) return serveDefaultCoverArt()

    // ar- 为歌手封面（暂无独立封面源），直接返回默认图
    if (id.startsWith('ar-')) return serveDefaultCoverArt()

    let musicInfo = null
    try {
      // Musiver 会给封面 id 拼 al- 前缀，去掉后按歌曲查
      const coverId = id.startsWith('al-') ? id.slice(3) : id
      musicInfo = await dbAPI.resolveMusicInfoById(coverId)
      if (!musicInfo) return serveDefaultCoverArt()
    } catch (err) {
      logger.warn('[cover] DB lookup failed:', err)
      return serveDefaultCoverArt()
    }

    try {
      const picUrl = await getPicNative(musicInfo)
      if (picUrl) {
        const fetched = await fetchImageFromUrl(picUrl)
        if (fetched) return fetched
      }
    } catch (err) {
      logger.debug('[cover] getPic failed:', err)
    }

    return serveDefaultCoverArt()
  } catch (err) {
    logger.error('[cover] error:', err)
    return serveDefaultCoverArt()
  }
}

/**
 * 从 URL 获取图片，返回图片响应；非图片/失败返回 null。
 */
async function fetchImageFromUrl(imageUrl: string): Promise<Response | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(imageUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      logger.warn('[cover] fetch failed, status:', response.status)
      return null
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.startsWith('image/')) {
      logger.warn('[cover] response is not an image:', contentType)
      return null
    }

    const buffer = await response.arrayBuffer()
    if (!buffer || buffer.byteLength === 0) return null

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    logger.warn('[cover] fetch error:', err)
    return null
  }
}

/**
 * 返回默认封面图片（public/icons/404.png）。
 */
function serveDefaultCoverArt(): Response {
  try {
    const coverPath = resolve(process.cwd(), 'public/icons/404.png')
    const buffer = readFileSync(coverPath)
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    logger.warn('[cover] default cover missing:', err)
    return new Response('Cover not found', { status: 404 })
  }
}
