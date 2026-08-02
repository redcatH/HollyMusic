/**
 * 音频缓存 Range serve 核心逻辑。
 *
 * 分支：
 * 1. enabled=false → 流式透传上游（无缓存）
 * 2. complete → 从正式文件按 Range 读（206）
 * 3. partial → 从 .tmp 读 [0, downloadedBytes]，超出 → 416
 * 4. downloading/miss → attach 或创建 Job，waitForBytes 后从 .tmp 读（边下边播）
 *
 * 边下边播 Range 截断：
 * - 浏览器请求 Range: bytes=A-B（B 通常为 size-1）
 * - 当前已下载 D 字节；actualEnd = min(B, D-1)
 * - 若 A >= D → waitForBytes(A)；超时 → 503
 * - 返回 206 Content-Range: bytes A-actualEnd/size，浏览器播完此段再请求下一段
 */

import fs from 'fs'
import fsp from 'fs/promises'
import { logger } from '@/lib/logger'
import { getAudioCacheConfig } from './config'
import { resolvePaths, absoluteFromRelative } from './paths'
import {
  getAudioCache,
  touchAccess,
  upsertDownloading,
  deleteRecord,
  type AudioCacheRecord,
} from './repository'
import { jobManager } from './job-manager'
import { maybeCollect } from './lru'

export interface ServeOptions {
  cacheKey: string
  upstreamUrl: string
  quality: string
  uid: string
  rangeHeader: string | null
  isHead: boolean
}

interface RangeSpec {
  start: number
  end: number
}

/**
 * 解析 Range 头。
 * - null/非 bytes=/多段 → null（无有效 Range，走 200 全量）
 * - start > size-1 → 'unsatisfiable'
 * - 正常 → { start, end }
 */
function parseRange(rangeHeader: string | null, size: number): RangeSpec | 'unsatisfiable' | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const spec = rangeHeader.slice(6).trim()
  if (spec.includes(',')) return null // 多段 Range，拒绝（走 200）

  const m = spec.match(/^(\d*)-(\d*)$/)
  if (!m) return null

  const startRaw = m[1]
  const endRaw = m[2]

  let start: number
  let end: number

  if (startRaw === '' && endRaw === '') {
    return null // bytes=- 无效
  }
  if (startRaw === '') {
    // 后缀：bytes=-N（取最后 N 字节）
    const n = parseInt(endRaw, 10)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else if (endRaw === '') {
    // bytes=N-
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

/** 构造 206 Partial Content 响应 */
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

  if (isHead) {
    return new Response(null, { status: 206, headers })
  }

  const stream = fs.createReadStream(filePath, { start: range.start, end: range.end })
  return new Response(stream as unknown as ReadableStream, { status: 206, headers })
}

/** 构造 200 全量响应（无 Range 头时） */
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
  if (isHead) {
    return new Response(null, { status: 200, headers })
  }
  const stream = fs.createReadStream(filePath)
  return new Response(stream as unknown as ReadableStream, { status: 200, headers })
}

/** 416 Range Not Satisfiable */
function buildUnsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'Content-Range': `bytes */${size}` },
  })
}

/** 503 seek 超时（水位线等待失败） */
function buildSeekTimeout(): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'SEEK_TIMEOUT', message: 'seek 超过已下载部分且等待超时' } }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )
}

/** 检查文件是否存在（不抛错） */
async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/** 流式透传上游（ENABLE_FILE_CACHE=false 或错误降级时） */
async function passthroughUpstream(upstreamUrl: string, rangeHeader: string | null): Promise<Response> {
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

/**
 * serve complete 记录：从正式文件读。
 */
function serveComplete(record: AudioCacheRecord, rangeHeader: string | null, isHead: boolean): Response {
  const filePath = absoluteFromRelative(record.filePath)
  const size = record.size ?? 0
  const contentType = record.contentType || 'audio/mpeg'

  const range = parseRange(rangeHeader, size)
  if (range === 'unsatisfiable') return buildUnsatisfiable(size)
  if (range === null) return buildFullResponse(filePath, size, contentType, isHead)
  return buildPartialResponse(filePath, size, contentType, range, isHead)
}

/**
 * serve partial 记录：从 .tmp 读 [0, downloadedBytes-1]。
 * size 为上游声明的总大小（Content-Range 的 TOTAL），downloadedBytes 为实际可读。
 */
function servePartial(record: AudioCacheRecord, rangeHeader: string | null, isHead: boolean): Response {
  const tmpPath = `${absoluteFromRelative(record.filePath)}.tmp`
  const size = record.size ?? record.downloadedBytes
  const available = record.downloadedBytes
  const contentType = record.contentType || 'audio/mpeg'

  const range = parseRange(rangeHeader, size)
  if (range === 'unsatisfiable') return buildUnsatisfiable(size)
  if (range === null) {
    // 无 Range，返回可读部分
    const r: RangeSpec = { start: 0, end: available - 1 }
    return buildPartialResponse(tmpPath, size, contentType, r, isHead)
  }

  // partial 不自动续传，超出可读部分直接截断到 available
  if (range.start >= available) return buildUnsatisfiable(size)
  const actualEnd = Math.min(range.end, available - 1)
  return buildPartialResponse(tmpPath, size, contentType, { start: range.start, end: actualEnd }, isHead)
}

/**
 * 主入口。
 */
export async function serve(opts: ServeOptions): Promise<Response> {
  const cfg = getAudioCacheConfig()

  // 总开关关闭 → 流式透传
  if (!cfg.enabled) {
    return passthroughUpstream(opts.upstreamUrl, opts.rangeHeader)
  }

  const record = await getAudioCache(opts.cacheKey)

  // complete
  if (record?.status === 'complete' && record.size) {
    const filePath = absoluteFromRelative(record.filePath)
    if (await fileExists(filePath)) {
      void touchAccess(opts.cacheKey)
      return serveComplete(record, opts.rangeHeader, opts.isHead)
    }
    // 文件丢失（被手动删除 / 磁盘故障）→ 删 DB 记录，回退到 miss 重新下载
    logger.warn(`[serve] complete 文件丢失，删除记录并重新下载: ${opts.cacheKey}`)
    await deleteRecord(opts.cacheKey)
  }

  // partial
  if (record?.status === 'partial' && record.downloadedBytes > 0) {
    const tmpPath = `${absoluteFromRelative(record.filePath)}.tmp`
    if (await fileExists(tmpPath)) {
      void touchAccess(opts.cacheKey)
      return servePartial(record, opts.rangeHeader, opts.isHead)
    }
    logger.warn(`[serve] partial .tmp 文件丢失，删除记录并重新下载: ${opts.cacheKey}`)
    await deleteRecord(opts.cacheKey)
  }

  // downloading（已有 job）或 miss（需创建 job）
  let job = jobManager.get(opts.cacheKey)
  if (!job) {
    // miss → 创建 DB 记录（占位 filePath，job readiness 后修正）+ 创建 job
    const placeholder = resolvePaths(opts.cacheKey, null).relativeFilePath
    await upsertDownloading(opts.cacheKey, placeholder, opts.quality, opts.uid)
    job = jobManager.getOrCreate({
      cacheKey: opts.cacheKey,
      upstreamUrl: opts.upstreamUrl,
      quality: opts.quality,
      uid: opts.uid,
    })
    // 后台触发 LRU 检查（新增一条下载，可能需清理）
    void maybeCollect()
  }

  // 等待 job readiness，超时返回 503（上游 hang 不响应 header）
  const readiness = await Promise.race([
    job.readiness,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('readiness timeout')), cfg.readinessTimeoutMs)
    ),
  ]).catch(() => null)

  if (!readiness) {
    logger.warn(`[serve] readiness 超时 ${opts.cacheKey}（${cfg.readinessTimeoutMs / 1000}秒）`)
    return new Response(
      JSON.stringify({ success: false, error: { code: 'READINESS_TIMEOUT', message: '上游响应超时' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // passthrough（无 Content-Length）→ 透传
  if (readiness.mode === 'passthrough') {
    if (!readiness.response.body?.locked) {
      return readiness.response
    }
    // body 已被其他并发请求消费 → 重新 fetch
    return passthroughUpstream(opts.upstreamUrl, opts.rangeHeader)
  }

  // cache 模式 → 边下边播
  const size = readiness.size
  const contentType = readiness.contentType || 'audio/mpeg'
  const tmpPath = readiness.paths.tmpPath

  const range = parseRange(opts.rangeHeader, size)
  if (range === 'unsatisfiable') return buildUnsatisfiable(size)

  // 确定 serve 范围
  let serveRange: RangeSpec
  if (range === null) {
    serveRange = { start: 0, end: size - 1 }
  } else {
    serveRange = range
  }

  // 若起点超出已下载字节 → 等待下载推进
  const downloaded = job.getDownloadedBytes()
  if (serveRange.start >= downloaded && job.getStatus() === 'downloading') {
    // waitForBytes 等的是"已下载到 serveRange.start"，实际要读到 start，需 start < downloadedBytes
    // 故传 serveRange.start（语义：downloadedBytes > start 即可读到 start）
    const ok = await job.waitForBytes(serveRange.start + 1, cfg.seekTimeoutMs)
    if (!ok) {
      logger.warn(`[serve] seek 超时 ${opts.cacheKey} @ ${serveRange.start} (下载到 ${job.getDownloadedBytes()})`)
      return buildSeekTimeout()
    }
  }

  // 截断 end 到已下载部分
  const currentDownloaded = job.getDownloadedBytes()
  const actualEnd = Math.min(serveRange.end, currentDownloaded - 1)

  if (serveRange.start > actualEnd) {
    // start 超出已下载（job 已结束但未覆盖）
    return buildUnsatisfiable(size)
  }

  void touchAccess(opts.cacheKey)

  // Windows 兼容：job 可能已完成并 rename .tmp → 正式文件，
  // 此时 .tmp 已不存在，createReadStream(tmpPath) 会 ENOENT。
  // 检查 job 状态：complete → 读正式文件；否则读 .tmp（边下边播）
  if (job.getStatus() === 'complete') {
    const filePath = readiness.paths.filePath
    return buildPartialResponse(filePath, size, contentType, { start: serveRange.start, end: actualEnd }, opts.isHead)
  }

  return buildPartialResponse(tmpPath, size, contentType, { start: serveRange.start, end: actualEnd }, opts.isHead)
}
