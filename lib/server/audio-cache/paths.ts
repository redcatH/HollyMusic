/**
 * 缓存文件路径管理。
 *
 * 设计要点：
 * - 用 cacheKey 的 SHA-256 哈希做文件名，避免非法字符 / 过长路径 / 平台差异
 * - 两级目录分片（哈希前 2 位做子目录），避免单目录文件过多（>10万）导致 fs 性能下降
 * - 下载期写 `.tmp`，完成后 fs.rename 原子替换；Linux 上已打开的旧 fd 继续指向旧 inode，
 *   读端不受写端替换影响——这是多用户边下边播一致性保证的核心
 * - 扩展名从 contentType 推断，缺省 .mp3
 */

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { getAudioCacheConfig } from './config'

/**
 * 计算 cacheKey 的分片哈希（不依赖文件系统，纯函数，便于测试）。
 * 返回形如 `ab/abcdef...` 的相对路径（不含扩展名）。
 */
export function hashRelativePath(cacheKey: string): string {
  const hex = crypto.createHash('sha256').update(cacheKey).digest('hex')
  const dir = hex.substring(0, 2)
  const rest = hex.substring(2)
  return path.join(dir, rest)
}

/** 由 contentType 推断扩展名 */
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
  /** 下载临时文件绝对路径 */
  tmpPath: string
  /** DB 中存储的相对路径（相对 root） */
  relativeFilePath: string
}

/**
 * 解析 cacheKey 对应的全部路径。不创建目录、不触碰磁盘。
 * ext 在上游 Content-Type 已知后补传；首次调用可传 null，
 * 后续 DownloadJob 拿到 contentType 后重新解析以拿到正确 ext。
 */
export function resolvePaths(cacheKey: string, ext: string | null): ResolvedPaths {
  const root = getAudioCacheConfig().cacheDir
  const relative = hashRelativePath(cacheKey)
  const finalExt = ext && ext.startsWith('.') ? ext : ext ? `.${ext}` : '.mp3'
  const shardDir = path.dirname(path.join(root, relative))
  const base = path.join(root, relative)
  return {
    root,
    shardDir,
    filePath: `${base}${finalExt}`,
    tmpPath: `${base}${finalExt}.tmp`,
    relativeFilePath: `${relative}${finalExt}`,
  }
}

/** 重新解析扩展名（DownloadJob 拿到 contentType 后调用） */
export function resolvePathsWithContentType(
  cacheKey: string,
  contentType: string | null | undefined
): ResolvedPaths {
  return resolvePaths(cacheKey, extFromContentType(contentType))
}

/** 确保缓存根目录与分片子目录存在（幂等） */
export async function ensureShardDir(shardDir: string): Promise<void> {
  await fs.mkdir(shardDir, { recursive: true })
}

/** 确保缓存根目录存在（启动时调用） */
export async function ensureCacheRoot(): Promise<void> {
  const root = getAudioCacheConfig().cacheDir
  await fs.mkdir(root, { recursive: true })
}

/**
 * 由 DB 中存储的 relativeFilePath 还原绝对路径。
 */
export function absoluteFromRelative(relativeFilePath: string): string {
  const root = getAudioCacheConfig().cacheDir
  return path.join(root, relativeFilePath)
}
