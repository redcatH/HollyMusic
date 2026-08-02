/**
 * 音频服务核心模块（2026-08 重构）。
 *
 * 设计原则（替代旧 lib/server/audio-cache）：
 * 1. DB 只记录「已完整下载」的文件；进行中状态只存内存 Map
 * 2. 多用户并发同一首歌 → 内存 Map 去重，上游只打 1 次
 * 3. 所有客户端从磁盘文件读，互不干扰；支持 Range seek
 * 4. seek 超出已下载部分 → 等待下载推进（最长 15 秒）→ 超时返回 503 + Retry-After
 * 5. 下载失败 → 删文件 + 删 Map entry（不留半成品，下次重下）
 * 6. 磁盘超配额 → LRU 清理 lastAccessAt 最老的
 *
 * 环境变量（仅 3 个）：
 * - ENABLE_FILE_CACHE       总开关，false 时流式透传上游（不缓存、不支持 seek）
 * - AUDIO_CACHE_DIR         缓存根目录
 * - AUDIO_CACHE_QUOTA_GB    磁盘配额（GB）
 */

import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { EventEmitter } from 'events'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

// ============================================================================
// 配置
// ============================================================================

export interface AudioServeConfig {
  /** 总开关；false 时退化为流式透传（无磁盘缓存、无 seek） */
  enabled: boolean
  /** 磁盘配额（字节） */
  quotaBytes: number
  /** 缓存根目录（绝对路径） */
  cacheDir: string
}

let cachedConfig: AudioServeConfig | null = null

export function getAudioServeConfig(): AudioServeConfig {
  if (cachedConfig) return cachedConfig

  const quotaGb = readInt('AUDIO_CACHE_QUOTA_GB', 10, 1)
  const dir = process.env.AUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), 'data/audio-cache')

  cachedConfig = {
    enabled: readBool('ENABLE_FILE_CACHE', true),
    quotaBytes: quotaGb * 1024 * 1024 * 1024,
    cacheDir: dir,
  }
  return cachedConfig
}

function readInt(envVar: string, fallback: number, min = 1): number {
  const raw = process.env[envVar]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback
  return Math.max(min, n)
}

function readBool(envVar: string, fallback: boolean): boolean {
  const raw = process.env[envVar]?.toLowerCase().trim()
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/** 仅供测试重置用 */
export function _resetAudioServeConfigForTest(): void {
  cachedConfig = null
}

// ============================================================================
// 路径解析（两级分片，避免单目录文件过多）
// ============================================================================

/** cacheKey → sha256 hex 字符串 */
function hashKey(cacheKey: string): string {
  return crypto.createHash('sha256').update(cacheKey).digest('hex')
}

/** contentType → 扩展名（默认 .mp3） */
function extFromContentType(contentType: string | null | undefined): string {
  if (!contentType) return '.mp3'
  const ct = contentType.toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
  }
  return map[ct] ?? '.mp3'
}

export interface ResolvedPaths {
  /** 缓存根目录（绝对） */
  root: string
  /** 分片子目录（绝对） */
  shardDir: string
  /** 正式文件绝对路径 */
  filePath: string
  /** DB 中存储的相对路径（相对 root） */
  relativeFilePath: string
}

/** 解析 cacheKey 的所有路径（不触碰磁盘）。contentType 可在 fetch 前传 null。 */
export function resolvePaths(cacheKey: string, contentType: string | null): ResolvedPaths {
  const cfg = getAudioServeConfig()
  const hex = hashKey(cacheKey)
  const dir = hex.substring(0, 2)
  const rest = hex.substring(2)
  const ext = extFromContentType(contentType)
  const relative = path.join(dir, rest + ext)
  const base = path.join(cfg.cacheDir, dir, rest)
  return {
    root: cfg.cacheDir,
    shardDir: path.dirname(base),
    filePath: `${base}${ext}`,
    relativeFilePath: relative,
  }
}

// ============================================================================
// 内存进行中任务表（多用户去重核心）
// ============================================================================

interface InflightEntry {
  /** 上游声明的总大小（fetch header 后才有，初始 null） */
  size: number | null
  /** 已落盘字节数 */
  downloadedBytes: number
  /** contentType */
  contentType: string | null
  /** 已知路径（fetch header 后 resolve） */
  paths: ResolvedPaths | null
  /** 是否已完成（用于 close 后清理） */
  done: boolean
  /** 错误（done=true 且 error 非 null 表示失败） */
  error: Error | null
  /** 进度事件总线 */
  emitter: EventEmitter
}

class AudioServe {
  /** 进行中任务表：cacheKey → entry */
  private inflight = new Map<string, InflightEntry>()
  /** seek 等待超时 */
  private readonly seekTimeoutMs = 15_000
  /** 503 后建议的重试间隔 */
  private readonly retryAfterSec = 3
  /** fetch 上游超时 */
  private readonly fetchTimeoutMs = 30_000
  /** 初始化幂等 */
  private initPromise: Promise<void> | null = null

  // --------------------------------------------------------------------------
  // 初始化
  // --------------------------------------------------------------------------

  /** 惰性初始化（创建缓存根目录 + 启动清理）。幂等。 */
  ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch(e => {
        this.initPromise = null
        logger.error('[AudioServe] 初始化失败:', e)
        throw e
      })
    }
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    const cfg = getAudioServeConfig()
    if (!cfg.enabled) {
      logger.info('[AudioServe] 已禁用（ENABLE_FILE_CACHE=false），将流式透传上游')
      return
    }
    await fsp.mkdir(cfg.cacheDir, { recursive: true })
    logger.info(
      `[AudioServe] 初始化完成 | 目录=${cfg.cacheDir} | 配额=${(cfg.quotaBytes / 1024 / 1024 / 1024).toFixed(1)}GB`
    )
  }

  // --------------------------------------------------------------------------
  // 主入口
  // --------------------------------------------------------------------------

  /**
   * serve 一个音频请求。
   *
   * @param opts.cacheKey     缓存键 `${source}:${songmid}:${quality}`
   * @param opts.upstreamUrlResolver  惰性解析上游 URL 的函数（仅在 miss 时调用）
   * @param opts.rangeHeader  请求的 Range 头（null 表示无 Range）
   * @param opts.isHead       HEAD 请求只返回头
   */
  async serve(opts: {
    cacheKey: string
    upstreamUrlResolver: () => Promise<string>
    rangeHeader: string | null
    isHead: boolean
  }): Promise<Response> {
    const cfg = getAudioServeConfig()

    // 总开关关闭 → 流式透传（不缓存、不支持 seek）
    if (!cfg.enabled) {
      const url = await opts.upstreamUrlResolver()
      return this.passthroughUpstream(url, opts.rangeHeader)
    }

    // 1. 已完整缓存 → 本地 Range（任意 seek）
    const complete = await this.tryServeFromDisk(opts.cacheKey, opts.rangeHeader, opts.isHead)
    if (complete) return complete

    // 2. 进行中 → attach 到现有 entry
    // 3. miss    → 创建 entry 并启动后台下载
    let entry = this.inflight.get(opts.cacheKey)
    if (!entry) {
      entry = await this.startDownload(opts.cacheKey, opts.upstreamUrlResolver)
    }

    // 4. 等待 size 已知（fetch header 返回）—— 上游 hang 时这里有上限
    const ready = await this.waitForReadiness(entry)
    if (!ready) {
      return this.build503('上游响应超时（fetch header 未返回）')
    }

    // 失败的 entry
    if (entry.error instanceof Error) {
      return this.build502(entry.error.message)
    }

    // 无 Content-Length → passthrough（无法 seek，给客户端顺序流）
    if (entry.size === null) {
      // 此分支理论上不会触发：startDownload 时若发现无 CL，会直接 resolve response 给首个客户端
      // 但为防外部调用顺序异常，兜底返回 503
      return this.build503('上游未返回 Content-Length，无法缓存')
    }

    // 5. 计算 serve 范围
    const size = entry.size
    const range = parseRange(opts.rangeHeader, size)
    if (range === 'unsatisfiable') return buildUnsatisfiable(size)

    const serveRange = range === null ? { start: 0, end: size - 1 } : range

    // 6. 若 start 超出已下载 → 等下载推进
    if (serveRange.start >= entry.downloadedBytes && !entry.done) {
      const ok = await this.waitForBytes(entry, serveRange.start + 1)
      if (!ok) {
        logger.warn(
          `[AudioServe] seek 超时 ${opts.cacheKey} @ ${serveRange.start} (已下载 ${entry.downloadedBytes})`
        )
        return this.build503Retry(`seek 到 ${serveRange.start} 等待超时`)
      }
    }

    // 7. 下载失败
    // 注意：用类型断言绕过 TS 对对象属性的过度窄化（前面 if-return 后 TS 认为 entry.error 是 null，
    // 但 await waitForBytes 后 entry.error 实际可能被设置）
    const failureErr = entry.error as Error | null
    if (failureErr) {
      return this.build502(failureErr.message)
    }

    // 8. 截断 end 到已下载部分，从磁盘读
    const actualEnd = Math.min(serveRange.end, entry.downloadedBytes - 1)
    if (serveRange.start > actualEnd) {
      return buildUnsatisfiable(size)
    }

    // 9. 找到实际可读文件路径（entry done 后可能 rename 过）
    const filePath = entry.paths!.filePath
    if (!(await fileExists(filePath))) {
      // 文件丢失（极端情况：entry 刚 close + LRU 删了）
      return this.build503('缓存文件丢失，请重试')
    }

    // 刷新 lastAccessAt（DB）
    void this.touchAccess(opts.cacheKey)

    return buildPartialResponse(
      filePath,
      size,
      entry.contentType || 'audio/mpeg',
      { start: serveRange.start, end: actualEnd },
      opts.isHead
    )
  }

  // --------------------------------------------------------------------------
  // 已完整缓存分支
  // --------------------------------------------------------------------------

  private async tryServeFromDisk(
    cacheKey: string,
    rangeHeader: string | null,
    isHead: boolean
  ): Promise<Response | null> {
    try {
      const record = await prisma.audioCache.findUnique({ where: { cacheKey } })
      if (!record || !record.size) return null

      const filePath = path.join(getAudioServeConfig().cacheDir, record.filePath)
      if (!(await fileExists(filePath))) {
        // 文件丢失（手动删除 / 磁盘故障）→ 删 DB 记录，回退到 miss
        logger.warn(`[AudioServe] complete 文件丢失，删除记录: ${cacheKey}`)
        await prisma.audioCache.delete({ where: { cacheKey } }).catch(() => {})
        return null
      }

      void this.touchAccess(cacheKey)

      const size = record.size
      const contentType = record.contentType || 'audio/mpeg'
      const range = parseRange(rangeHeader, size)
      if (range === 'unsatisfiable') return buildUnsatisfiable(size)
      if (range === null) return buildFullResponse(filePath, size, contentType, isHead)
      return buildPartialResponse(filePath, size, contentType, range, isHead)
    } catch (e) {
      logger.error(`[AudioServe] tryServeFromDisk 失败 ${cacheKey}:`, e)
      return null
    }
  }

  // --------------------------------------------------------------------------
  // 下载启动（fetch header 后才知道 size 和 contentType）
  // --------------------------------------------------------------------------

  private async startDownload(
    cacheKey: string,
    upstreamUrlResolver: () => Promise<string>
  ): Promise<InflightEntry> {
    // 同步占位，保证并发请求只创建一个 entry（多用户去重核心）
    const entry: InflightEntry = {
      size: null,
      downloadedBytes: 0,
      contentType: null,
      paths: null,
      done: false,
      error: null,
      emitter: new EventEmitter(),
    }
    this.inflight.set(cacheKey, entry)

    // 后台异步执行（不阻塞调用方）
    void this.runDownload(cacheKey, entry, upstreamUrlResolver)

    // 后台触发 LRU 检查（新增一条下载，可能需要清理）
    void this.maybeCollect()

    return entry
  }

  private async runDownload(
    cacheKey: string,
    entry: InflightEntry,
    upstreamUrlResolver: () => Promise<string>
  ): Promise<void> {
    try {
      const url = await upstreamUrlResolver()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs)
      if (timer.unref) timer.unref()

      let resp: Response
      try {
        resp = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        })
      } finally {
        clearTimeout(timer)
      }

      if (!resp.ok) {
        throw new Error(`upstream ${resp.status} ${resp.statusText}`)
      }

      const cl = resp.headers.get('content-length')
      const size = cl ? parseInt(cl, 10) : NaN
      entry.contentType = resp.headers.get('content-type')

      // 无 Content-Length → 无法缓存，直接 passthrough 给首个客户端
      // 但本设计的 serve() 走的是「全部从磁盘读」语义，不支持 passthrough 分支
      // 故这里把 body 消费掉 + 把 entry 标记成 error，让调用方走 503 重试逻辑
      // （极端情况，上游 API 一般都返回 CL）
      if (!Number.isFinite(size) || size <= 0) {
        // 消费 body 释放连接
        await resp.body?.cancel().catch(() => {})
        throw new Error('上游未返回 Content-Length，无法缓存（建议启用透传模式）')
      }

      entry.size = size
      entry.paths = resolvePaths(cacheKey, entry.contentType)
      await fsp.mkdir(entry.paths.shardDir, { recursive: true })

      logger.debug(
        `[AudioServe] start ${cacheKey} size=${size} type=${entry.contentType}`
      )

      // 边下边写盘
      const writeStream = fs.createWriteStream(entry.paths.filePath)
      const reader = resp.body?.getReader()
      if (!reader) throw new Error('upstream body empty')

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await new Promise<void>((resolve, reject) => {
            writeStream.write(value, err => (err ? reject(err) : resolve()))
          })
          entry.downloadedBytes += value.length
          entry.emitter.emit('progress', entry.downloadedBytes)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: Error | null) => (err ? reject(err) : resolve()))
      })

      // 校验大小
      if (entry.downloadedBytes !== entry.size) {
        logger.warn(
          `[AudioServe] size mismatch: expected ${entry.size}, got ${entry.downloadedBytes}`
        )
        // 删除半成品文件
        await fsp.unlink(entry.paths.filePath).catch(() => {})
        throw new Error(`下载不完整：${entry.downloadedBytes}/${entry.size}`)
      }

      // 写入 DB（complete）
      await prisma.audioCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          filePath: entry.paths.relativeFilePath,
          size,
          contentType: entry.contentType,
        },
        update: {
          filePath: entry.paths.relativeFilePath,
          size,
          contentType: entry.contentType,
          lastAccessAt: new Date(),
        },
      })

      entry.done = true
      entry.emitter.emit('complete', entry.downloadedBytes)
      logger.debug(`[AudioServe] complete ${cacheKey}`)
    } catch (e) {
      entry.error = e instanceof Error ? e : new Error(String(e))
      entry.done = true
      entry.emitter.emit('error', entry.error)
      logger.warn(`[AudioServe] failed ${cacheKey}: ${entry.error.message}`)
    } finally {
      // 完成（成功或失败）后从 Map 移除
      // - 成功 → DB 已是事实来源，新请求查 DB 命中
      // - 失败 → 下次请求重新 startDownload
      this.inflight.delete(cacheKey)
      entry.emitter.removeAllListeners()
    }
  }

  // --------------------------------------------------------------------------
  // 等待机制
  // --------------------------------------------------------------------------

  /** 等 size 已知（fetch header 返回）。无超时——靠 fetch 自身的 timeout 兜底 */
  private waitForReadiness(entry: InflightEntry): Promise<boolean> {
    if (entry.size !== null || entry.error) return Promise.resolve(true)
    return new Promise(resolve => {
      const onReady = () => {
        cleanup()
        resolve(true)
      }
      const onError = () => {
        cleanup()
        resolve(true) // error 也算 ready，让调用方走 error 分支
      }
      const cleanup = () => {
        entry.emitter.off('progress', onReady)
        entry.emitter.off('complete', onError)
        entry.emitter.off('error', onError)
      }
      // progress 首次触发即表示 size 已知
      entry.emitter.once('progress', onReady)
      entry.emitter.once('error', onError)
      entry.emitter.once('complete', onError)
    })
  }

  /** 等下载推进到 target 字节。超时返回 false。 */
  private waitForBytes(entry: InflightEntry, target: number): Promise<boolean> {
    if (entry.downloadedBytes >= target) return Promise.resolve(true)
    if (entry.done) return Promise.resolve(entry.downloadedBytes >= target)

    return new Promise(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        entry.emitter.off('progress', onProgress)
        entry.emitter.off('complete', onComplete)
        entry.emitter.off('error', onError)
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), this.seekTimeoutMs)
      const onProgress = (downloaded: number) => {
        if (downloaded >= target) finish(true)
      }
      const onComplete = () => finish(entry.downloadedBytes >= target)
      const onError = () => finish(false)
      entry.emitter.on('progress', onProgress)
      entry.emitter.on('complete', onComplete)
      entry.emitter.on('error', onError)
    })
  }

  // --------------------------------------------------------------------------
  // passthrough（ENABLE_FILE_CACHE=false）
  // --------------------------------------------------------------------------

  private async passthroughUpstream(
    upstreamUrl: string,
    rangeHeader: string | null
  ): Promise<Response> {
    const resp = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    })
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
    const ct = resp.headers.get('content-type')
    if (ct) headers['Content-Type'] = ct
    const cl = resp.headers.get('content-length')
    if (cl) headers['Content-Length'] = cl
    return new Response(resp.body, { status: resp.status, headers })
  }

  // --------------------------------------------------------------------------
  // LRU 清理
  // --------------------------------------------------------------------------

  /** 触发一次 LRU 检查（达配额 80% 时清理到 70%） */
  private async maybeCollect(): Promise<void> {
    try {
      const cfg = getAudioServeConfig()
      const current = await this.getCurrentBytes()
      const high = cfg.quotaBytes * 0.8
      const low = cfg.quotaBytes * 0.7
      if (current < high) return

      logger.info(
        `[AudioServe] LRU 触发：当前 ${(current / 1024 / 1024).toFixed(1)}MB，清理到 ${((low / 1024 / 1024) / 1024).toFixed(1)}GB`
      )
      await this.collectGarbage(low)
    } catch (e) {
      logger.error('[AudioServe] LRU 清理失败:', e)
    }
  }

  /** 当前磁盘缓存总字节（DB 聚合） */
  async getCurrentBytes(): Promise<number> {
    const agg = await prisma.audioCache.aggregate({ _sum: { size: true } })
    return agg._sum.size ?? 0
  }

  /**
   * 清理到 targetBytes：按 lastAccessAt 升序删除最老的。
   * 同步删 DB 记录与磁盘文件。
   */
  async collectGarbage(targetBytes: number): Promise<{ deleted: number; bytesFreed: number }> {
    const cfg = getAudioServeConfig()
    let current = await this.getCurrentBytes()
    if (current <= targetBytes) return { deleted: 0, bytesFreed: 0 }

    let deleted = 0
    let bytesFreed = 0

    // 分批扫描，避免一次拉太多
    while (current > targetBytes) {
      const batch = await prisma.audioCache.findMany({
        orderBy: { lastAccessAt: 'asc' },
        take: 50,
      })
      if (batch.length === 0) break

      for (const row of batch) {
        const filePath = path.join(cfg.cacheDir, row.filePath)
        await fsp.unlink(filePath).catch(() => {})
        await prisma.audioCache.delete({ where: { cacheKey: row.cacheKey } }).catch(() => {})
        deleted++
        bytesFreed += row.size ?? 0
        current -= row.size ?? 0
        if (current <= targetBytes) break
      }
    }

    if (deleted > 0) {
      logger.info(`[AudioServe] LRU 清理：删除 ${deleted} 个文件，释放 ${bytesFreed} 字节`)
    }
    return { deleted, bytesFreed }
  }

  // --------------------------------------------------------------------------
  // 辅助
  // --------------------------------------------------------------------------

  /** 刷新 DB 中 lastAccessAt（serve 命中时调用，LRU 依据） */
  private async touchAccess(cacheKey: string): Promise<void> {
    try {
      await prisma.audioCache.update({
        where: { cacheKey },
        data: { lastAccessAt: new Date() },
      })
    } catch {
      // 记录可能已被 LRU 删，忽略
    }
  }

  private build503(message: string): Response {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'READINESS_TIMEOUT', message } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  private build503Retry(message: string): Response {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'SEEK_TIMEOUT', message } }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(this.retryAfterSec),
        },
      }
    )
  }

  private build502(message: string): Response {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'UPSTREAM_FAILED', message } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ============================================================================
// 响应构造（与旧 serve.ts 等价，独立实现避免循环依赖）
// ============================================================================

interface RangeSpec {
  start: number
  end: number
}

/** 解析 Range 头。null = 无 Range；'unsatisfiable' = 416；对象 = 有效范围 */
function parseRange(rangeHeader: string | null, size: number): RangeSpec | 'unsatisfiable' | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const spec = rangeHeader.slice(6).trim()
  if (spec.includes(',')) return null

  const m = spec.match(/^(\d*)-(\d*)$/)
  if (!m) return null

  const startRaw = m[1]
  const endRaw = m[2]

  let start: number
  let end: number

  if (startRaw === '' && endRaw === '') return null
  if (startRaw === '') {
    const n = parseInt(endRaw, 10)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else if (endRaw === '') {
    start = parseInt(startRaw, 10)
    if (!Number.isFinite(start)) return null
    end = size - 1
  } else {
    start = parseInt(startRaw, 10)
    end = parseInt(endRaw, 10)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null
    end = Math.min(end, size - 1)
  }

  if (start > size - 1) return 'unsatisfiable'
  if (start < 0) start = 0
  return { start, end }
}

/**
 * 把 Node fs.ReadStream 包装成 Web ReadableStream<Uint8Array>。
 *
 * 必要性：直接把 fs.ReadStream cast 成 ReadableStream 传给 Next.js Response，
 * 客户端拖动进度条取消请求时，undici 会调用 stream.cancel()；此时若底层
 * fs.ReadStream 已结束/关闭，再次 cancel/error 会抛
 * `TypeError: Invalid state: ReadableStream is already closed`（ERR_INVALID_STATE），
 * 成为 uncaughtException 导致进程告警甚至崩溃。
 *
 * 本包装：
 * 1. 用 Web ReadableStream 标准生命周期接管 pull/cancel
 * 2. cancel() 主动 destroy 底层 fs.ReadStream，吞掉后续 'error' 事件
 * 3. 底层 'error' 先于 'end' 触发时，通过 controller.error() 优雅传递给下游
 */
function wrapFileStream(nodeStream: fs.ReadStream): ReadableStream<Uint8Array> {
  // 底层流已绑定的 error 事件（防止 destroy 后再抛）
  let errored = false
  nodeStream.on('error', () => {
    errored = true
  })

  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', chunk => {
        // backpressure：队列满时暂停，drain 后恢复
        if (!controller.desiredSize || controller.desiredSize <= 0) {
          nodeStream.pause()
          // drain 只在非 flowing 模式下触发，这里用 nextTick 恢复
          process.nextTick(() => nodeStream.resume())
        }
        // fs.ReadStream 的 chunk 是 Buffer（Uint8Array 子类），直接 enqueue
        controller.enqueue(chunk as Uint8Array)
      })
      nodeStream.on('end', () => {
        if (!errored) controller.close()
      })
      nodeStream.on('error', err => {
        controller.error(err)
      })
    },
    cancel() {
      // 客户端断连：销毁底层流，吞掉 destroy 触发的 error
      nodeStream.destroy()
    },
  })
}

function buildPartialResponse(
  filePath: string,
  size: number,
  contentType: string,
  range: RangeSpec,
  isHead: boolean
): Response {
  const contentLength = range.end - range.start + 1
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(contentLength),
    'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  }
  if (isHead) return new Response(null, { status: 206, headers })
  const stream = fs.createReadStream(filePath, { start: range.start, end: range.end })
  return new Response(wrapFileStream(stream), { status: 206, headers })
}

function buildFullResponse(
  filePath: string,
  size: number,
  contentType: string,
  isHead: boolean
): Response {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(size),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  }
  if (isHead) return new Response(null, { status: 200, headers })
  const stream = fs.createReadStream(filePath)
  return new Response(wrapFileStream(stream), { status: 200, headers })
}

function buildUnsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'Content-Range': `bytes */${size}` },
  })
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// 全局单例
// ============================================================================

export const audioServe = new AudioServe()

// ============================================================================
// 上层接口（供 admin/cache 路由与 clear 路由调用）
// ============================================================================

/** 统计：磁盘缓存总数与字节 */
export async function getStats(): Promise<{
  total: number
  totalBytes: number
}> {
  try {
    const [total, agg] = await Promise.all([
      prisma.audioCache.count(),
      prisma.audioCache.aggregate({ _sum: { size: true } }),
    ])
    return {
      total,
      totalBytes: agg._sum.size ?? 0,
    }
  } catch (e) {
    logger.error('[AudioServe] getStats 失败:', e)
    return { total: 0, totalBytes: 0 }
  }
}

/** 清空所有音频缓存（DB + 文件） */
export async function clearAllAudioCache(): Promise<{ count: number; bytes: number } | null> {
  try {
    const cfg = getAudioServeConfig()
    const all = await prisma.audioCache.findMany({ select: { filePath: true, size: true } })
    let bytes = 0
    for (const row of all) {
      const fp = path.join(cfg.cacheDir, row.filePath)
      await fsp.unlink(fp).catch(() => {})
      bytes += row.size ?? 0
    }
    const result = await prisma.audioCache.deleteMany({})
    return { count: result.count, bytes }
  } catch (e) {
    logger.error('[AudioServe] clearAllAudioCache 失败:', e)
    return null
  }
}

export interface OrphanFile {
  absolutePath: string
  relativePath: string
  size: number
}

/**
 * 扫描孤儿文件：磁盘上存在但 DB 无记录的文件。
 * 新设计里 DB 即事实来源，孤儿即"DB 已删但文件还在"的残留。
 */
export async function scanOrphanFiles(): Promise<{ count: number; bytes: number; orphans: OrphanFile[] }> {
  const cfg = getAudioServeConfig()
  const orphans: OrphanFile[] = []

  if (!(await fileExists(cfg.cacheDir))) {
    return { count: 0, bytes: 0, orphans: [] }
  }

  // DB 中所有 relativePath
  const records = await prisma.audioCache.findMany({ select: { filePath: true } })
  const known = new Set(records.map(r => r.filePath))

  // 遍历磁盘
  async function walk(dir: string) {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.isFile()) {
        const rel = path.relative(cfg.cacheDir, full).split(path.sep).join('/')
        if (!known.has(rel)) {
          try {
            const stat = await fsp.stat(full)
            orphans.push({ absolutePath: full, relativePath: rel, size: stat.size })
          } catch {
            // 文件可能被并发删
          }
        }
      }
    }
  }

  await walk(cfg.cacheDir).catch(() => {})

  const bytes = orphans.reduce((s, o) => s + o.size, 0)
  return { count: orphans.length, bytes, orphans }
}

/** 删除指定的孤儿文件（来自 scanOrphanFiles 结果） */
export async function deleteOrphanFiles(
  orphans: OrphanFile[]
): Promise<{ deleted: number; bytes: number }> {
  let deleted = 0
  let bytes = 0
  for (const o of orphans) {
    await fsp.unlink(o.absolutePath).catch(() => {})
    deleted++
    bytes += o.size
  }
  return { deleted, bytes }
}

// ============================================================================
// 惰性初始化触发（首次 import 时排队，route 调用 ensureInitialized 再等待）
// ============================================================================

void audioServe.ensureInitialized()
