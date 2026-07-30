import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import https from 'https'
import { resolveMusicInfoById } from '@/lib/db'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import { musicSourceManager } from '@/lib/music-source-manager'
import { urlCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'
import type { MusicInfo, QualityType } from '@/lib/types/music'

// ============================================================================
// CONFIG
// ============================================================================

// 创建忽略证书验证的 HTTPS agent
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
})

const URL_CACHE_TTL = 210 * 60 * 1000 // 210 分钟
const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || path.join(process.cwd(), '.cache', 'audio')
const AUDIO_CACHE_TTL_DAYS = parseInt(process.env.AUDIO_CACHE_TTL_DAYS || '7', 10)
const ENABLE_FILE_CACHE = process.env.ENABLE_FILE_CACHE === 'true' // 默认开启，可通过 ENABLE_FILE_CACHE=false 关闭

const EXT_CONTENT_TYPE_MAP: Record<string, string> = {
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

// ============================================================================
// LAYER 1: CONTENT-TYPE DETECTION
// ============================================================================

/**
 * 根据音质类型和文件扩展名智能判断 Content-Type
 */
function getContentType(quality: QualityType, fileExt?: string): string {
  if (fileExt) {
    const ext = fileExt.toLowerCase()
    if (EXT_CONTENT_TYPE_MAP[ext]) {
      return EXT_CONTENT_TYPE_MAP[ext]
    }
  }
  if (quality === 'flac' || quality === 'flac24bit') {
    return 'audio/flac'
  }
  // 默认返回 MP3
  return 'audio/mpeg'
}

/**
 * 根据请求的音质和支持的音质列表，选择最接近的音质
 * 优先级：flac24bit > flac > 320k > 128k
 */
function selectQuality(requestedQuality: QualityType, supportedTypes: QualityType[]): QualityType {
  if (supportedTypes.includes(requestedQuality)) {
    return requestedQuality
  }

  // 如果不支持请求的音质，按优先级降级
  const qualityPriority: QualityType[] = ['flac24bit', 'flac', '320k', '128k']
  for (const q of qualityPriority) {
    if (supportedTypes.includes(q)) {
      logger.debug(`[selectQuality] Requested ${requestedQuality} not available, downgrading to ${q}`)
      return q
    }
  }

  // 如果都不支持，返回第一个可用的
  logger.warn(`[selectQuality] No matching quality found, using first available: ${supportedTypes[0]}`)
  return supportedTypes[0]
}

// ============================================================================
// LAYER 2: FILE CACHE MANAGER
// ============================================================================

const FileCache = {
  /**
   * 确保缓存目录存在
   */
  ensureDir(): void {
    try {
      if (!fs.existsSync(AUDIO_CACHE_DIR)) {
        fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true })
        logger.info(`[FileCache] Created directory: ${AUDIO_CACHE_DIR}`)
      }
    } catch (err) {
      logger.error('[FileCache] Failed to create directory:', err)
    }
  },

  /**
   * 生成缓存文件名：{source}-{songmid}-{quality}.mp3
   */
  generateFileName(source: string, songmid: string, quality: QualityType): string {
    const sanitized = String(songmid).replace(/[/\\:*?"<>|]/g, '_')
    return `${source}-${sanitized}-${quality}.mp3`
  },

  /**
   * 获取缓存文件完整路径
   */
  getFilePath(source: string, songmid: string, quality: QualityType): string {
    return path.join(AUDIO_CACHE_DIR, this.generateFileName(source, songmid, quality))
  },

  /**
   * 检查文件缓存是否有效（存在且未过期）
   */
  isValid(source: string, songmid: string, quality: QualityType): boolean {
    const filePath = this.getFilePath(source, songmid, quality)
    try {
      if (!fs.existsSync(filePath)) return false
      const stats = fs.statSync(filePath)
      const ageMs = Date.now() - stats.mtimeMs
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      if (ageDays > AUDIO_CACHE_TTL_DAYS) {
        logger.debug(`[FileCache] File expired (${ageDays.toFixed(1)} days): ${filePath}`)
        return false
      }
      logger.debug(`[FileCache] File valid (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${path.basename(filePath)}`)
      return true
    } catch (err) {
      logger.error('[FileCache] Failed to check validity:', err)
      return false
    }
  },

  /**
   * 从磁盘读取缓存文件
   */
  async read(source: string, songmid: string, quality: QualityType): Promise<Buffer | null> {
    if (!this.isValid(source, songmid, quality)) return null
    const filePath = this.getFilePath(source, songmid, quality)
    try {
      const buffer = await fs.promises.readFile(filePath)
      logger.info(`[FileCache] Read: ${path.basename(filePath)} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`)
      return buffer
    } catch (err) {
      logger.error('[FileCache] Failed to read:', err)
      return null
    }
  },

  /**
   * 保存文件到磁盘（从 Response 流中）
   */
  async save(source: string, songmid: string, quality: QualityType, res: Response): Promise<boolean> {
    this.ensureDir()
    const filePath = this.getFilePath(source, songmid, quality)
    try {
      if (!res.body) {
        logger.warn('[FileCache] No response body to save')
        return false
      }

      const writer = fs.createWriteStream(filePath)
      const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader()

      return await new Promise<boolean>((resolve) => {
        ; (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) writer.write(Buffer.from(value))
            }
            writer.end()
          } catch (err) {
            logger.error('[FileCache] Stream error while saving:', err)
            try { writer.destroy() } catch { }
            try { fs.unlinkSync(filePath) } catch { }
            resolve(false)
          }
        })()

        writer.on('finish', () => {
          try {
            const stats = fs.statSync(filePath)
            logger.info(`[FileCache] Saved: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`)
            resolve(true)
          } catch (_err) {
            logger.error('[FileCache] Failed to verify file:', _err)
            resolve(false)
          }
        })
        writer.on('error', (err) => {
          logger.error('[FileCache] Write error:', err)
          try { fs.unlinkSync(filePath) } catch { }
          resolve(false)
        })
      })
    } catch (err) {
      logger.error('[FileCache] Failed to save:', err)
      return false
    }
  }
}

FileCache.ensureDir()

// ============================================================================
// LAYER 3: AUDIO STREAM PROXY
// ============================================================================

const AudioProxy = {
  /**
   * 获取音频流（自动处理重定向）
   */
  async fetchStream(url: string, quality: QualityType): Promise<Response> {
    try {
      const fetchOptions: RequestInit & { agent?: https.Agent } = {
        redirect: 'follow', // 自动跟踪重定向
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      }

      // 如果是 HTTPS，使用忽略证书验证的 agent
      if (url.startsWith('https://')) {
        fetchOptions.agent = httpsAgent
      }

      logger.debug(`[AudioProxy] Fetching from: ${url.substring(0, 100)}...`)
      const streamRes = await fetch(url, fetchOptions)

      if (!streamRes.ok) {
        throw new Error(`Fetch failed: ${streamRes.status} ${streamRes.statusText}`)
      }

      // 构建响应头
      const headers = new Headers()

      // 智能设置 Content-Type
      let contentType = streamRes.headers.get('Content-Type')
      if (!contentType || contentType === 'application/octet-stream') {
        try {
          const urlObj = new URL(streamRes.url || url)
          const ext = path.extname(urlObj.pathname).toLowerCase()
          contentType = getContentType(quality, ext) || 'audio/mpeg'
        } catch {
          contentType = getContentType(quality)
        }
      }
      headers.set('Content-Type', contentType)

      // 复制 Content-Length
      const contentLength = streamRes.headers.get('Content-Length')
      if (contentLength) {
        headers.set('Content-Length', contentLength)
      }

      // 设置标准响应头
      headers.set('Connection', 'keep-alive')
      headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
      headers.set('Date', new Date().toUTCString())

      logger.debug(`[AudioProxy] Response: ${contentType}, ${contentLength || 'unknown'} bytes`)

      return new Response(streamRes.body, { status: streamRes.status, headers })
    } catch (err) {
      logger.error('[AudioProxy] Failed to fetch stream:', err instanceof Error ? err.message : String(err))
      throw err
    }
  },

  /**
   * 获取并代理音频流
   */
  async getStream(url: string, quality: QualityType): Promise<Response> {
    try {
      return await this.fetchStream(url, quality)
    } catch {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 0, message: 'Failed to proxy audio stream' }
      })
      return createSubsonicResponse(xml)
    }
  }
}

// ============================================================================
// LAYER 4: URL RESOLVER
// ============================================================================

const UrlResolver = {
  /**
   * 尝试从内存 URL 缓存获取 URL
   */
  getFromMemoryCache(source: string, songmid: string, quality: QualityType): string | null {
    const cacheKey = `url:${source}:${songmid}:${quality}`
    const cached = urlCache.get(cacheKey)
    if (cached) {
      logger.debug(`[UrlResolver] Memory cache hit: ${cacheKey}`)
      return cached as string
    }
    return null
  },

  /**
   * 从音源管理器获取新 URL
   */
  async fetchFromManager(musicInfo: MusicInfo, quality: QualityType): Promise<string> {
    if (!musicSourceManager.isInitialized()) {
      logger.info('[UrlResolver] Initializing music source manager...')
      await musicSourceManager.initialize()
    }

    logger.debug(`[UrlResolver] Fetching URL from manager: ${musicInfo.songmid} (${quality})`)
    const url = await musicSourceManager.getMusicUrl(musicInfo, quality)

    if (!url) {
      throw new Error(`No URL available for ${musicInfo.songmid}`)
    }

    // 保存到内存缓存
    const cacheKey = `url:${musicInfo.source}:${musicInfo.songmid}:${quality}`
    urlCache.set(cacheKey, url, URL_CACHE_TTL)
    logger.info(`[UrlResolver] URL cached: ${cacheKey}`)

    return url
  },

  /**
   * 获取播放 URL（先查内存缓存，再从音源管理器获取）
   */
  async resolve(musicInfo: MusicInfo, quality: QualityType): Promise<string> {
    const cached = this.getFromMemoryCache(musicInfo.source, musicInfo.songmid, quality)
    if (cached) {
      return cached
    }

    return await this.fetchFromManager(musicInfo, quality)
  }
}

// ============================================================================
// LAYER 5: BUSINESS LOGIC - STREAM HANDLER
// ============================================================================

export async function handleStream(request: NextRequest): Promise<Response> {

  // ---------- 测试分支：读取固定测试文件并返回 ----------
  // 触发方式：在请求中添加查询参数 `?testFile=mg`

  // const testPath = 'D:\\work\\user\\online\\linux\\web\\my-music\\.cache\\audio\\mg-1140461527-320k.mp3'
  // try {


  //   // GET 请求：读取完整文件并返回（用于测试）
  //   const buffer = await fs.promises.readFile(testPath)
  //   // const u8 = new Uint8Array((buffer as Buffer).buffer, (buffer as Buffer).byteOffset, (buffer as Buffer).byteLength)
  //   const resp = new Response(buffer, { status: 200 })
  //   resp.headers.set('Content-Type', 'audio/mpeg; charset=utf-8')
  //   resp.headers.set('Content-Length', String(buffer.length))
  //   resp.headers.set('Date', new Date().toUTCString())
  //   resp.headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
  //   return resp
  // } catch (err) {
  //   logger.error('[handleStream] Error serving test file:', err)
  //   const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Test file serve failed' } })
  //   return createSubsonicResponse(xml)
  // }


  const url = new URL(request.url)
  const id = url.searchParams.get('id') || ''
  const maxBitRate = parseInt(url.searchParams.get('maxBitRate') || '0', 10)

  try {
    // 诊断日志：记录请求方法、URL、id、Range 与 User-Agent，便于排查客户端重复 GET 问题
    logger.debug(`[handleStream] Incoming request method=${request.method} url=${request.url} id=${id} range=${request.headers.get('range')} ua=${request.headers.get('user-agent')}`)


    // ========== STEP 1: 使用 ID 从数据库查找 MusicInfo ==========
    // 统一走 resolveMusicInfoById：优先按 `source-songmid` 精确匹配，回退按 songmid 全库查找
    let musicInfo: MusicInfo | null = null
    if (!id) {
      logger.warn('[handleStream] Missing id parameter')
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 70, message: 'Missing id' } })
      return createSubsonicResponse(xml)
    }

    musicInfo = await resolveMusicInfoById(id)

    if (!musicInfo) {
      logger.warn(`[handleStream] Invalid ID: no musicInfo found for id=${id}`)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: 'Invalid song id' }
      })
      return createSubsonicResponse(xml)
    }

    // ========== STEP 2: 验证 MusicInfo 必填字段 ==========
    const missingFields = []
    if (!musicInfo.source) missingFields.push('source')
    if (!musicInfo.songmid) missingFields.push('songmid')
    if (!musicInfo.name) missingFields.push('name')
    if (!musicInfo.singer) missingFields.push('singer')

    if (missingFields.length > 0) {
      logger.warn(`[handleStream] Missing fields: ${missingFields.join(', ')}`)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: 'Invalid song info' }
      })
      return createSubsonicResponse(xml)
    }

    // ========== STEP 3: 确定音质 ==========
    // 先按 maxBitRate 判断理想音质，再根据 musicInfo.types 支持情况选择最接近的
    let idealQuality: QualityType = '320k'
    if (maxBitRate >= 800) idealQuality = 'flac'
    else if (maxBitRate >= 500) idealQuality = '320k'
    else if (maxBitRate >= 200) idealQuality = '128k'
    else if (maxBitRate > 0) idealQuality = '128k'

    // 获取音源支持的所有音质
    const supportedQualities: QualityType[] = musicInfo.types.map(t => t.type)
    if (supportedQualities.length === 0) {
      logger.warn(`[handleStream] No supported qualities found for ${musicInfo.songmid}`)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 0, message: 'No supported audio quality available' }
      })
      return createSubsonicResponse(xml)
    }

    // 从支持的音质中选择最接近的
    const quality = selectQuality(idealQuality, supportedQualities)
    logger.debug(`[handleStream] Quality selection: requested=${idealQuality}, supported=[${supportedQualities.join(',')}], selected=${quality}`)

    logger.info(`[handleStream] Stream request: ${musicInfo.name} - ${musicInfo.singer} (quality: ${quality})`)

    // ========== STEP 4: 检查本地文件缓存 ==========
    if (ENABLE_FILE_CACHE) {
      logger.debug(`[handleStream] Checking file cache...`)
      const cachedBuffer = await FileCache.read(musicInfo.source, musicInfo.songmid, quality)
      if (cachedBuffer) {
        logger.info(`[handleStream] Returning cached file from disk`)
        const u8 = new Uint8Array((cachedBuffer as Buffer).buffer, (cachedBuffer as Buffer).byteOffset, (cachedBuffer as Buffer).byteLength)
        const response = new NextResponse(u8 as unknown as BodyInit, { status: 200 })
        response.headers.set('Content-Type', getContentType(quality))
        response.headers.set('Content-Length', String(cachedBuffer.length))
        response.headers.set('Date', new Date().toUTCString())
        response.headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
        return response
      }
    }

    // ========== STEP 5: 获取播放 URL ==========
    logger.debug(`[handleStream] Resolving play URL...`)
    const playUrl = await UrlResolver.resolve(musicInfo as MusicInfo, quality)
    logger.info(`[handleStream] Got play URL: ${playUrl.substring(0, 80)}...`)

    // ========== STEP 6: 获取音频流 ==========
    logger.debug(`[handleStream] Proxying audio stream...`)
    const streamResponse = await AudioProxy.getStream(playUrl, quality)

    // ========== STEP 7: 立即返回流给客户端，同时后台异步保存到缓存 ==========
    if (streamResponse.status === 200 && streamResponse.headers.get('Content-Type')?.includes('audio')) {
      // 如果开启文件缓存，后台异步保存（不阻塞客户端响应）
      if (ENABLE_FILE_CACHE) {
        // 在后台执行保存，不等待
        ;(async () => {
          try {
            logger.debug(`[handleStream] Background: saving to file cache...`)
            const clone = streamResponse.clone()
            const saveSuccess = await FileCache.save(musicInfo.source, musicInfo.songmid, quality, clone)
            if (saveSuccess) {
              logger.info(`[handleStream] Background: file cache saved successfully`)
            } else {
              logger.warn(`[handleStream] Background: failed to save file cache`)
            }
          } catch (err) {
            logger.error('[handleStream] Background: error during cache save:', err)
          }
        })()
      }

      // 立即返回响应给客户端（不等待后台保存完成）
      const headers = new Headers(streamResponse.headers)
      headers.set('Content-Type', getContentType(quality))
      headers.set('Connection', 'keep-alive')
      headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
      headers.set('Date', new Date().toUTCString())
      
      logger.info(`[handleStream] Returning stream to client (async cache save in background)`)
      return new NextResponse(streamResponse.body, { status: streamResponse.status, headers })
    }

    // 如果响应不是成功的音频，返回错误
    logger.error('[handleStream] Invalid stream response')
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 70, message: 'Stream request failed' }
    })
    return createSubsonicResponse(xml)
  } catch (err) {
    logger.error('[handleStream] Error:', err instanceof Error ? err.message : String(err))
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 0, message: 'Stream request failed' }
    })
    return createSubsonicResponse(xml)
  }
}
