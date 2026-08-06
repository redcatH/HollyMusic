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
import { logger } from '@/lib/logger'
import { sanitizeFilename } from '@/lib/server/download-utils'
import type { MusicSourcesConfig, SourceConfig } from '@/lib/types/music'
import { musicSourceManager } from '@/lib/music-source-manager'

const CONFIG_PATH = path.resolve(process.cwd(), 'config/music-sources.json')
const SCRIPTS_DIR = path.resolve(process.cwd(), 'custom-sources')

const VALID_PLATFORMS = ['tx', 'wy', 'kw', 'kg', 'mg'] as const
const MAX_SCRIPT_SIZE = 5 * 1024 * 1024 // 5MB

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

/** 读取配置（带缓存校验） */
export async function readConfig(): Promise<MusicSourcesConfig> {
  const raw = await fsp.readFile(CONFIG_PATH, 'utf-8')
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

  config.sources.push(newSource)
  await writeConfig(config)
  await notifyReload()
  logger.info(`[source-manager-service] 新增源: ${newSource.path}`)
  return newSource
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
}
