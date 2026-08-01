/**
 * 全局下载任务管理器。
 *
 * 职责：
 * - 同一 cacheKey 的下载请求去重（多用户同时点同一首只下一个上游）
 * - 并发下载上限（信号量），超出排队，保护上游与服务端内存
 * - job 完成后从 Map 移除（DB 已是事实来源，新请求查 DB 即可）
 *
 * 并发安全：
 * - getOrCreate 是同步函数，内部 has-check-then-set 无 await，不会交错
 * - 信号量用 Promise 队列实现，acquire/release 严格配对
 */

import { logger } from '@/lib/logger'
import { getAudioCacheConfig } from './config'
import { DownloadJob, type DownloadJobOptions } from './download-job'

class Semaphore {
  private permits: number
  private waiters: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    await new Promise<void>(resolve => {
      this.waiters.push(resolve)
    })
    // 被 release 唤醒时 permit 已被让出
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) {
      // 直接把 permit 转交给等待者（不减不增）
      next()
    } else {
      this.permits++
    }
  }
}

class JobManager {
  private jobs = new Map<string, DownloadJob>()
  private semaphore: Semaphore
  /** 正在排队（未获取 permit）的 job，用于 abort 时清理 */
  private initializing = new Set<string>()

  constructor() {
    const cfg = getAudioCacheConfig()
    this.semaphore = new Semaphore(cfg.maxConcurrent)
  }

  /**
   * 获取或创建 cacheKey 对应的下载 Job。
   *
   * 同步语义（无 await），保证多用户并发请求时只创建一个 Job。
   * - 若 Job 已存在且未结束 → 返回它（attach 复用）
   * - 若不存在 → 创建并异步启动（受信号量约束）
   *
   * 返回的 Job 可能刚创建（readiness 未 resolve），调用方需 await job.readiness。
   */
  getOrCreate(opts: DownloadJobOptions): DownloadJob {
    const { cacheKey } = opts

    // 已有进行中的 Job → 复用
    const existing = this.jobs.get(cacheKey)
    if (existing) {
      return existing
    }

    // 正在初始化（排队等信号量）→ 等待复用
    // 由于 getOrCreate 是同步的，initializing 检查防止极短时间内重复创建
    if (this.initializing.has(cacheKey)) {
      // 极端情况：同步循环内连续调用。给一个临时的 awaiting Job？
      // 实际不会发生（调用方必有 await 间隔），此处兜底创建新的（下一轮 getOrCreate 会命中 jobs）
    }

    const job = new DownloadJob(opts)
    this.jobs.set(cacheKey, job)
    this.initializing.add(cacheKey)

    // 异步启动（不阻塞调用方）
    void this.runJob(job)

    return job
  }

  /** 获取现有 Job（不创建），用于 serve 层判断是否已有进行中的下载 */
  get(cacheKey: string): DownloadJob | null {
    return this.jobs.get(cacheKey) ?? null
  }

  private async runJob(job: DownloadJob): Promise<void> {
    const { cacheKey } = job
    try {
      await this.semaphore.acquire()
    } finally {
      this.initializing.delete(cacheKey)
    }

    try {
      await job.start()
    } catch (e) {
      // start 内部已处理错误（markPartial / resolve readiness），这里只兜底
      logger.error(`[JobManager] job.start threw (should not happen): ${cacheKey}`, e)
    } finally {
      this.semaphore.release()
      // Job 完成（complete/failed/passthrough）后移除：
      // - complete → DB 已是事实来源，新请求查 DB 命中
      // - failed(partial) → DB 已更新，新请求查 DB 命中 partial
      // - passthrough → 无缓存，新请求查 DB miss，重新创建 Job
      // 正在 waitForBytes 的调用方通过事件 resolve，不受移除影响
      this.jobs.delete(cacheKey)
    }
  }

  /** 进程退出 / 清理时调用：中止所有进行中的 Job */
  abortAll(): void {
    for (const job of this.jobs.values()) {
      job.abort()
    }
    this.jobs.clear()
    this.initializing.clear()
  }
}

/** 全局单例 */
export const jobManager = new JobManager()
