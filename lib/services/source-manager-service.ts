/**
 * 音源配置管理服务。
 *
 * 职责：
 * - 原子读写 config/music-sources.json（临时文件 + rename）
 * - 脚本预校验（用 LXEnvironmentSimulator 试加载，确认能 inited 才保存）
 * - CRUD 业务封装（增删改后主动通知 MusicSourceManager 重建实例，立即生效）
 *
 * 脚本路径约定：相对项目根，存于 custom-sources/ 目录。
 */

import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import dns from 'dns/promises'
import net from 'net'
import { logger } from '@/lib/logger'
import { sanitizeFilename } from '@/lib/server/download-utils'
import type { MusicSourcesConfig, SourceConfig } from '@/lib/types/music'
import { musicSourceManager } from '@/lib/music-source-manager'

const CONFIG_PATH = path.resolve(process.cwd(), 'config/music-sources.json')
const SCRIPTS_DIR = path.resolve(process.cwd(), 'custom-sources')

const VALID_PLATFORMS = ['tx', 'wy', 'kw', 'kg', 'mg'] as const
const MAX_SCRIPT_SIZE = 5 * 1024 * 1024 // 5MB
const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 15_000
const MAX_SUBSCRIPTION_REDIRECTS = 3

export class SourceSubscriptionError extends Error {
  constructor(message: string, public readonly status: number = 422) {
    super(message)
    this.name = 'SourceSubscriptionError'
  }
}

/**
 * 通知 MusicSourceManager 重建实例，使配置改动立即生效。
 * 失败不抛错：配置已成功写入，下次播放请求的 MD5 懒重载会兜底。
 */
async function notifyReload(): Promise<void> {
  try {
    await musicSourceManager.reload()
  } catch (e) {
    logger.warn('[source-manager-service] 重建音源实例失败，将依赖下次请求懒重载:', e instanceof Error ? e.message : e)
  }
}

// 动态 require 模拟器（CommonJS 模块）
type SimulatorConstructor = new () => {
  executeScript(content: string): Promise<unknown>
  sourceInfo: Record<string, unknown>
}
let LXEnvironmentSimulatorCtor: SimulatorConstructor | null = null
async function getSimulatorCtor(): Promise<SimulatorConstructor> {
  if (LXEnvironmentSimulatorCtor) return LXEnvironmentSimulatorCtor
  // 复用 lib/music-core/index.js（与 music-source-manager.ts 一致的加载方式）
  // 相对路径 require，避免 Turbopack 对别名 '@/lx-env-simulator' 的静态解析失败
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../music-core/index')
  LXEnvironmentSimulatorCtor = (mod.default || mod) as SimulatorConstructor
  return LXEnvironmentSimulatorCtor
}

/** 读取配置（带缓存校验）。文件不存在时自动初始化空配置并落盘，避免首次部署报 ENOENT。 */
export async function readConfig(): Promise<MusicSourcesConfig> {
  let raw: string
  try {
    raw = await fsp.readFile(CONFIG_PATH, 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      logger.warn(`[source-manager-service] ${CONFIG_PATH} 不存在，初始化空配置`)
      const empty: MusicSourcesConfig = { sources: [] }
      await writeConfig(empty)
      return empty
    }
    throw e
  }
  const parsed = JSON.parse(raw) as MusicSourcesConfig
  if (!Array.isArray(parsed.sources)) {
    throw new Error('配置文件格式无效：sources 必须是数组')
  }
  return parsed
}

/** 原子写入配置（临时文件 + rename） */
export async function writeConfig(config: MusicSourcesConfig): Promise<void> {
  // 按 priority 升序排列
  const sorted = {
    ...config,
    sources: [...config.sources].sort((a, b) => a.priority - b.priority),
  }
  const json = JSON.stringify(sorted, null, 2)
  const tmp = CONFIG_PATH + '.tmp'
  await fsp.writeFile(tmp, json, 'utf-8')
  try {
    await fsp.rename(tmp, CONFIG_PATH)
  } catch {
    // Windows 下若 CONFIG_PATH 被占用 rename 可能失败，回退直接写
    await fsp.writeFile(CONFIG_PATH, json, 'utf-8')
    await fsp.unlink(tmp).catch(() => {})
  }
  logger.debug('[source-manager-service] 配置已写入')
}

/** 检查脚本文件是否存在 */
export async function scriptExists(relativePath: string): Promise<boolean> {
  try {
    const abs = path.resolve(process.cwd(), relativePath)
    await fsp.access(abs)
    return true
  } catch {
    return false
  }
}

export interface ScriptValidationResult {
  ok: boolean
  sourceInfo?: Record<string, unknown>
  error?: string
}

/**
 * 用 LXEnvironmentSimulator 预校验脚本（同步等待 inited）。
 * - 成功 → { ok: true, sourceInfo }
 * - 失败 → { ok: false, error }
 */
export async function validateScriptContent(scriptContent: string): Promise<ScriptValidationResult> {
  try {
    const Ctor = await getSimulatorCtor()
    const sim = new Ctor()
    await sim.executeScript(scriptContent)
    return {
      ok: true,
      sourceInfo: sim.sourceInfo,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 保存上传的脚本文件。
 * - 文件名 sanitize
 * - 重名冲突时追加数字后缀
 * - 不做内容校验（校验由 upload route 在保存前完成）
 *
 * @param originalName 原始文件名
 * @param content 文件内容（字符串）
 * @returns 最终保存的相对路径（相对项目根）
 */
export async function saveScript(originalName: string, content: string): Promise<string> {
  await fsp.mkdir(SCRIPTS_DIR, { recursive: true })

  // sanitize 文件名（保留中文字符，去危险字符）
  let name = sanitizeFilename(originalName)
  if (!name.endsWith('.js')) name += '.js'

  // 重名冲突追加数字
  let target = path.join(SCRIPTS_DIR, name)
  let counter = 1
  while (fs.existsSync(target)) {
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    target = path.join(SCRIPTS_DIR, `${base}-${counter}${ext}`)
    counter++
  }

  await fsp.writeFile(target, content, 'utf-8')
  const rel = path.relative(process.cwd(), target).replace(/\\/g, '/')
  logger.info(`[source-manager-service] 脚本已保存: ${rel}`)
  return rel
}

/** 将已存在的 custom-sources 脚本原子替换为新内容。 */
async function replaceScript(relativePath: string, content: string): Promise<void> {
  const target = path.resolve(process.cwd(), relativePath)
  const relativeToScriptsDir = path.relative(SCRIPTS_DIR, target)
  if (
    !relativeToScriptsDir ||
    relativeToScriptsDir.startsWith('..') ||
    path.isAbsolute(relativeToScriptsDir) ||
    path.extname(target).toLowerCase() !== '.js'
  ) {
    throw new SourceSubscriptionError('订阅脚本必须位于 custom-sources 目录且为 .js 文件', 400)
  }

  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tempPath, content, 'utf-8')
  try {
    await fsp.rename(tempPath, target)
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {})
    throw err
  }
}

function isPublicIp(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) {
    const [first, second] = address.split('.').map(Number)
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19))
    )
  }
  if (version === 6) {
    const normalized = address.toLowerCase()
    if (normalized.startsWith('::ffff:')) return isPublicIp(normalized.slice('::ffff:'.length))
    return !(
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
  }
  return false
}

/** 校验远程订阅地址，拒绝本机及私网地址，避免管理员接口成为 SSRF 入口。 */
async function validateSubscriptionUrl(value: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SourceSubscriptionError('请输入有效的在线脚本链接', 400)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SourceSubscriptionError('订阅链接仅支持 HTTP 或 HTTPS', 400)
  }
  if (url.username || url.password) {
    throw new SourceSubscriptionError('订阅链接不能包含账号信息', 400)
  }
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new SourceSubscriptionError('不允许访问本机或内网订阅地址', 400)
  }

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => [])
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new SourceSubscriptionError('不允许访问本机、内网或无法解析的订阅地址', 400)
  }
  return url
}

function getSubscriptionFilename(url: URL): string {
  const filename = path.basename(decodeURIComponent(url.pathname))
  return filename && filename !== '/' ? filename : 'lx-subscription.js'
}

/** 下载在线洛雪脚本，处理超时、大小限制和重定向。 */
async function fetchSubscriptionScript(subscriptionUrl: string): Promise<{ content: string; filename: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SUBSCRIPTION_REQUEST_TIMEOUT_MS)
  try {
    let url = await validateSubscriptionUrl(subscriptionUrl.trim())
    const filename = getSubscriptionFilename(url)

    for (let redirectCount = 0; redirectCount <= MAX_SUBSCRIPTION_REDIRECTS; redirectCount++) {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'HollyMusic Source Subscription' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new SourceSubscriptionError('订阅链接重定向地址无效')
        url = await validateSubscriptionUrl(new URL(location, url).toString())
        continue
      }
      if (!response.ok) {
        throw new SourceSubscriptionError(`下载订阅脚本失败：HTTP ${response.status}`)
      }

      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_SCRIPT_SIZE) {
        throw new SourceSubscriptionError(`订阅脚本过大，上限 ${MAX_SCRIPT_SIZE / 1024 / 1024}MB`)
      }
      const content = await response.text()
      if (Buffer.byteLength(content, 'utf-8') > MAX_SCRIPT_SIZE) {
        throw new SourceSubscriptionError(`订阅脚本过大，上限 ${MAX_SCRIPT_SIZE / 1024 / 1024}MB`)
      }
      return { content, filename }
    }
    throw new SourceSubscriptionError('订阅链接重定向次数过多')
  } catch (err) {
    if (err instanceof SourceSubscriptionError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SourceSubscriptionError('下载订阅脚本超时，请稍后重试')
    }
    throw new SourceSubscriptionError(`下载订阅脚本失败：${err instanceof Error ? err.message : '未知错误'}`)
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 删除脚本文件（忽略不存在） */
export async function deleteScript(relativePath: string): Promise<void> {
  const abs = path.resolve(process.cwd(), relativePath)
  try {
    await fsp.unlink(abs)
    logger.info(`[source-manager-service] 脚本已删除: ${relativePath}`)
  } catch {
    // 文件不存在，忽略
  }
}

/** 列出所有源配置（附带脚本文件存在状态 + sourceInfo） */
export interface SourceWithStatus extends SourceConfig {
  scriptExists: boolean
  /** 从 sourceInfo 提取的平台列表（可能未加载过，为空） */
  supportedPlatforms?: string[]
}

export async function listSourcesWithStatus(): Promise<SourceWithStatus[]> {
  const config = await readConfig()
  const result: SourceWithStatus[] = []
  for (const s of config.sources) {
    const exists = await scriptExists(s.path)
    result.push({ ...s, scriptExists: exists })
  }
  return result
}

/** 新增一条源配置（path 唯一性校验） */
export async function addSource(opts: {
  path: string
  name?: string
  description?: string
  priority?: number
  timeout?: number
  enabled?: boolean
  pt?: string[]
  subscription?: SourceConfig['subscription']
}): Promise<SourceConfig> {
  const config = await readConfig()

  // path 唯一性
  if (config.sources.some(s => s.path === opts.path)) {
    throw new Error(`脚本路径已存在: ${opts.path}`)
  }

  // priority 默认 = 当前最大 +1
  const maxPriority = config.sources.reduce((max, s) => Math.max(max, s.priority), 0)

  const newSource: SourceConfig = {
    path: opts.path,
    enabled: opts.enabled ?? true,
    priority: opts.priority ?? maxPriority + 1,
  }
  if (opts.name) newSource.name = opts.name
  if (opts.description) newSource.description = opts.description
  if (opts.timeout) newSource.timeout = opts.timeout
  if (opts.pt && opts.pt.length > 0) {
    newSource.pt = opts.pt.filter(p => (VALID_PLATFORMS as readonly string[]).includes(p))
  }
  if (opts.subscription) newSource.subscription = opts.subscription

  config.sources.push(newSource)
  await writeConfig(config)
  await notifyReload()
  logger.info(`[source-manager-service] 新增源: ${newSource.path}`)
  return newSource
}

/** 从在线链接导入洛雪脚本，校验通过后自动注册为可更新订阅。 */
export async function importSubscription(subscriptionUrl: string): Promise<SourceConfig> {
  const normalizedUrl = subscriptionUrl.trim()
  const { content, filename } = await fetchSubscriptionScript(normalizedUrl)
  const validation = await validateScriptContent(content)
  if (!validation.ok) {
    throw new SourceSubscriptionError(`脚本校验失败：${validation.error || '未知错误'}`)
  }

  const relativePath = await saveScript(filename, content)
  try {
    const sourceInfo = validation.sourceInfo as { name?: string; description?: string } | undefined
    const source = await addSource({
      path: relativePath,
      name: sourceInfo?.name || filename.replace(/\.js$/i, ''),
      description: sourceInfo?.description,
      enabled: true,
      pt: extractPlatforms(validation.sourceInfo),
      subscription: { url: normalizedUrl, updatedAt: new Date().toISOString() },
    })
    logger.info(`[source-manager-service] 已导入订阅脚本: ${normalizedUrl} → ${relativePath}`)
    return source
  } catch (err) {
    await deleteScript(relativePath)
    throw err
  }
}

/** 手动拉取并更新一个已订阅的洛雪脚本。 */
export async function updateSubscribedSource(sourcePath: string): Promise<SourceConfig> {
  const config = await readConfig()
  const index = config.sources.findIndex(source => source.path === sourcePath)
  if (index < 0) throw new SourceSubscriptionError(`找不到源配置: ${sourcePath}`, 404)

  const source = config.sources[index]
  if (!source.subscription?.url) {
    throw new SourceSubscriptionError('该音源不是在线订阅，无法更新', 400)
  }

  const { content } = await fetchSubscriptionScript(source.subscription.url)
  const validation = await validateScriptContent(content)
  if (!validation.ok) {
    throw new SourceSubscriptionError(`脚本校验失败：${validation.error || '未知错误'}`)
  }

  await replaceScript(source.path, content)
  const updated: SourceConfig = {
    ...source,
    pt: extractPlatforms(validation.sourceInfo),
    subscription: { ...source.subscription, updatedAt: new Date().toISOString() },
  }
  config.sources[index] = updated
  await writeConfig(config)
  await notifyReload()
  logger.info(`[source-manager-service] 已更新订阅脚本: ${source.subscription.url} → ${source.path}`)
  return updated
}

/** 更新一条源配置（按 path 定位） */
export async function updateSource(
  sourcePath: string,
  opts: {
    name?: string
    description?: string
    priority?: number
    timeout?: number
    enabled?: boolean
    pt?: string[]
  }
): Promise<SourceConfig> {
  const config = await readConfig()
  const idx = config.sources.findIndex(s => s.path === sourcePath)
  if (idx < 0) throw new Error(`找不到源配置: ${sourcePath}`)

  const updated = { ...config.sources[idx] }
  if (opts.name !== undefined) updated.name = opts.name
  if (opts.description !== undefined) updated.description = opts.description
  if (opts.priority !== undefined) updated.priority = opts.priority
  if (opts.timeout !== undefined) updated.timeout = opts.timeout
  if (opts.enabled !== undefined) updated.enabled = opts.enabled
  if (opts.pt !== undefined) {
    updated.pt = opts.pt.filter(p => (VALID_PLATFORMS as readonly string[]).includes(p))
  }

  config.sources[idx] = updated
  await writeConfig(config)
  await notifyReload()
  logger.info(`[source-manager-service] 更新源: ${sourcePath}`)
  return updated
}

/** 删除一条源配置 + 关联脚本文件 */
export async function removeSource(sourcePath: string): Promise<void> {
  const config = await readConfig()
  const idx = config.sources.findIndex(s => s.path === sourcePath)
  if (idx < 0) throw new Error(`找不到源配置: ${sourcePath}`)

  config.sources.splice(idx, 1)
  await writeConfig(config)
  await notifyReload()

  // 删除关联脚本文件
  await deleteScript(sourcePath)
  logger.info(`[source-manager-service] 删除源 + 脚本: ${sourcePath}`)
}

/** 从脚本 sourceInfo 提取支持平台（用于上传后自动填充 pt） */
export function extractPlatforms(sourceInfo: Record<string, unknown> | undefined): string[] {
  if (!sourceInfo?.sources || typeof sourceInfo.sources !== 'object') return []
  const platforms = Object.keys(sourceInfo.sources as Record<string, unknown>)
  return platforms.filter(p => (VALID_PLATFORMS as readonly string[]).includes(p))
}

export const SOURCE_MANAGER_CONSTANTS = {
  MAX_SCRIPT_SIZE,
  VALID_PLATFORMS,
  SCRIPTS_DIR,
  CONFIG_PATH,
  SUBSCRIPTION_REQUEST_TIMEOUT_MS,
}
