/**
 * 单个缓存键的下载任务引擎（两阶段：ready → consume）。
 *
 * 阶段 1 (ready)：fetch 上游 → 检测 Content-Length
 *   - 有 CL → readiness resolve 为 cache 模式，进入阶段 2
 *   - 无 CL → readiness resolve 为 passthrough 模式，返回上游 Response 给上层透传，Job 不落盘
 *
 * 阶段 2 (consume)：写 .tmp（每 chunk 确认落盘后推进水位）→ rename 原子替换 → complete
 *   ↘ 失败 → 保留 .tmp + markPartial（serve 仍可读已下载部分）
 *
 * 多用户一致性保证：
 * - 下载期 serve 读 .tmp；complete 后 rename，Linux 原子 rename 保证已打开的旧 fd
 *   继续读旧 inode，新请求读正式文件——读端不受写端替换影响
 * - 本 Job 只处理「从零开始的首次下载」，不覆盖已有 partial（避免破坏正在读的连接）
 */

import { EventEmitter } from 'events'
import fs from 'fs'
import fsp from 'fs/promises'
import { logger } from '@/lib/logger'
import { markComplete, markPartial, updateProgress, updateFilePath } from './repository'
import { ensureShardDir, resolvePathsWithContentType, type ResolvedPaths } from './paths'
import { getAudioCacheConfig } from './config'

export type JobStatus = 'pending' | 'downloading' | 'complete' | 'failed'

export type Readiness =
  | { mode: 'cache'; size: number; contentType: string | null; paths: ResolvedPaths }
  | { mode: 'passthrough'; response: Response }

export interface DownloadJobOptions {
  cacheKey: string
  upstreamUrl: string
  quality: string
  uid: string
}

export class DownloadJob extends EventEmitter {
  readonly cacheKey: string
  private readonly upstreamUrl: string
  private readonly quality: string
  private readonly uid: string

  private downloadedBytes = 0
  private size: number | null = null
  private contentType: string | null = null
  private status: JobStatus = 'pending'
  private paths: ResolvedPaths | null = null
  private abortController: AbortController | null = null
  private writeStream: fs.WriteStream | null = null
  private maxLifetimeTimer: ReturnType<typeof setTimeout> | null = null

  /** 阶段 1 完成后 resolve；上层据此决定走 cache 还是 passthrough */
  readonly readiness: Promise<Readiness>
  private readinessResolve!: (v: Readiness) => void

  constructor(opts: DownloadJobOptions) {
    super()
    this.cacheKey = opts.cacheKey
    this.upstreamUrl = opts.upstreamUrl
    this.quality = opts.quality
    this.uid = opts.uid
    this.readiness = new Promise(resolve => {
      this.readinessResolve = resolve
    })
  }

  getDownloadedBytes(): number {
    return this.downloadedBytes
  }

  getStatus(): JobStatus {
    return this.status
  }

  getContentType(): string | null {
    return this.contentType
  }

  getSize(): number | null {
    return this.size
  }

  /** serve 应读的文件绝对路径：complete 读正式文件，否则读 .tmp */
  getServeFilePath(): string | null {
    if (!this.paths) return null
    return this.status === 'complete' ? this.paths.filePath : this.paths.tmpPath
  }

  /**
   * 等待下载推进到 target 字节。
   * - 已超过 target → 立即 true
   * - complete/failed → 返回当前是否已覆盖 target
   * - downloading → 监听 progress，超时返回 false
   */
  async waitForBytes(target: number, timeoutMs: number): Promise<boolean> {
    if (this.downloadedBytes >= target) return true
    if (this.status !== 'downloading') return this.downloadedBytes >= target

    return new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.off('progress', onProgress)
        this.off('complete', onComplete)
        this.off('error', onError)
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      const onProgress = () => {
        if (this.downloadedBytes >= target) finish(true)
      }
      const onComplete = () => finish(this.downloadedBytes >= target)
      const onError = () => finish(this.downloadedBytes >= target)
      this.on('progress', onProgress)
      this.on('complete', onComplete)
      this.on('error', onError)
    })
  }

  /** 取消下载（如进程退出） */
  abort(): void {
    this.abortController?.abort()
  }

  /** 清理 maxLifetime 定时器（complete/failed 时调用） */
  private clearMaxLifetimeTimer(): void {
    if (this.maxLifetimeTimer) {
      clearTimeout(this.maxLifetimeTimer)
      this.maxLifetimeTimer = null
    }
  }

  /** 启动整个流程：fetch → 检测 CL → cache 下载 或 passthrough */
  async start(): Promise<void> {
    this.abortController = new AbortController()
    this.status = 'downloading'

    // 最大生命周期定时器：超时自动 abort，防止上游 hang 导致永久卡死 + 信号量泄漏
    const cfg = getAudioCacheConfig()
    this.maxLifetimeTimer = setTimeout(() => {
      if (this.status === 'downloading') {
        logger.warn(`[DownloadJob] maxLifetime 超时 ${this.cacheKey}，abort`)
        this.abortController?.abort()
      }
    }, cfg.jobMaxLifetimeMs)
    if (this.maxLifetimeTimer.unref) this.maxLifetimeTimer.unref()

    try {
      const resp = await fetch(this.upstreamUrl, {
        signal: this.abortController.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })

      if (!resp.ok) {
        throw new Error(`upstream ${resp.status} ${resp.statusText}`)
      }

      const contentLengthHeader = resp.headers.get('content-length')
      const size = contentLengthHeader ? parseInt(contentLengthHeader, 10) : NaN

      if (!Number.isFinite(size) || size <= 0) {
        // 无 Content-Length → passthrough，交上层透传
        this.contentType = resp.headers.get('content-type')
        this.status = 'failed'
        this.readinessResolve({ mode: 'passthrough', response: resp })
        return
      }

      this.size = size
      this.contentType = resp.headers.get('content-type')
      this.paths = resolvePathsWithContentType(this.cacheKey, this.contentType)
      await ensureShardDir(this.paths.shardDir)

      // resolve readiness（cache 模式），上层可开始等待字节
      this.readinessResolve({
        mode: 'cache',
        size: this.size,
        contentType: this.contentType,
        paths: this.paths,
      })

      // 修正 DB 文件路径（upsertDownloading 时扩展名为占位，此处按 contentType 修正）
      updateFilePath(this.cacheKey, this.paths.relativeFilePath).catch(() => {})

      logger.debug(`[DownloadJob] start ${this.cacheKey} size=${this.size} type=${this.contentType}`)

      await this.consumeBody(resp)
      await this.finalize()
    } catch (e) {
      await this.handleFailure(e)
    }
  }

  /** 消费上游 body，逐 chunk 写 .tmp */
  private async consumeBody(resp: Response): Promise<void> {
    this.writeStream = fs.createWriteStream(this.paths!.tmpPath)
    const reader = resp.body?.getReader()
    if (!reader) throw new Error('upstream body empty')

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        // 确认落盘后再推进水位（保证 serve 可读）
        await new Promise<void>((resolve, reject) => {
          this.writeStream!.write(value, err => (err ? reject(err) : resolve()))
        })
        this.downloadedBytes += value.length
        this.emit('progress', { downloadedBytes: this.downloadedBytes, size: this.size })

        // 异步更新 DB（不阻塞下载循环）
        updateProgress(this.cacheKey, this.downloadedBytes, this.size!, this.contentType).catch(() => {})
      }
    } finally {
      await reader.cancel().catch(() => {})
    }

    await new Promise<void>((resolve, reject) => {
      this.writeStream!.end((err: Error | null) => (err ? reject(err) : resolve()))
    })
  }

  /** 下载完成：校验 + 原子 rename + markComplete */
  private async finalize(): Promise<void> {
    if (this.downloadedBytes !== this.size) {
      logger.warn(
        `[DownloadJob] size mismatch: expected ${this.size}, got ${this.downloadedBytes}`
      )
      await markPartial(this.cacheKey, this.downloadedBytes)
      this.status = 'failed'
      this.emit('error', { downloadedBytes: this.downloadedBytes, reason: 'size mismatch' })
      return
    }

    // 原子替换：.tmp → 正式文件
    // Linux: 已打开 .tmp 的 fd 继续读旧 inode；新请求读正式文件
    // Windows: 若正式文件被占用 rename 可能失败，回退为覆盖写
    try {
      await fsp.rename(this.paths!.tmpPath, this.paths!.filePath)
    } catch (e) {
      logger.warn(`[DownloadJob] rename failed, fallback overwrite: ${(e as Error).message}`)
      await fsp.copyFile(this.paths!.tmpPath, this.paths!.filePath)
      await fsp.unlink(this.paths!.tmpPath).catch(() => {})
    }

    await markComplete(this.cacheKey, this.size!, this.contentType)
    this.status = 'complete'
    this.clearMaxLifetimeTimer()
    this.emit('complete', { size: this.size, filePath: this.paths!.filePath })
    logger.debug(`[DownloadJob] complete ${this.cacheKey}`)
  }

  private async handleFailure(e: unknown): Promise<void> {
    const reason = e instanceof Error ? e.message : String(e)

    // fetch 阶段失败（readiness 未 resolve）：构造 502 response 让上层透传报错
    if (this.downloadedBytes === 0 && !this.writeStream) {
      this.status = 'failed'
      this.readinessResolve({
        mode: 'passthrough',
        response: new Response(
          JSON.stringify({ success: false, error: { code: 'UPSTREAM_FAILED', message: reason } }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        ),
      })
      this.emit('error', { downloadedBytes: 0, reason })
      logger.warn(`[DownloadJob] fetch failed ${this.cacheKey}: ${reason}`)
      return
    }

    // 下载阶段失败：保留 .tmp 已下载部分，标记 partial
    this.status = 'failed'
    this.clearMaxLifetimeTimer()
    if (this.writeStream && !this.writeStream.destroyed) {
      await new Promise<void>(resolve => this.writeStream!.end(() => resolve()))
    }
    logger.warn(
      `[DownloadJob] failed ${this.cacheKey} at ${this.downloadedBytes}/${this.size ?? '?'}: ${reason}`
    )
    if (this.downloadedBytes > 0) {
      await markPartial(this.cacheKey, this.downloadedBytes).catch(() => {})
    }
    this.emit('error', { downloadedBytes: this.downloadedBytes, reason })
  }
}
