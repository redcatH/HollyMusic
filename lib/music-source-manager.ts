/**
 * 音源管理服务
 * 管理多个 LXEnvironmentSimulator 实例，提供智能 URL 获取
 * 支持配置文件热重载
 */

import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { MusicInfo, QualityType, HealthStatus, SourceInfo } from './types/music'
import { ConfigValidator } from './config-validator'
import { logger } from './logger'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LXEnvironmentSimulator = require('./music-core/index')

// Define the type for the simulator instance
type SimulatorType = InstanceType<typeof LXEnvironmentSimulator>

interface SimulatorInstance {
  simulator: SimulatorType
  config: {
    name: string
    priority: number
    enabled: boolean
    timeout?: number
    pt?: string[] // 用户声明的支持平台，优先于脚本 sourceInfo 用于过滤
  }
  initialized: boolean
  initTime?: number
  sourceInfo?: SourceInfo
  error?: string
}

/**
 * 计算文件的 MD5 哈希值
 */
function getFileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return crypto.createHash('md5').update(content).digest('hex')
  } catch {
    return null
  }
}

/**
 * 从音源返回值中提取歌词。
 * 兼容两种返回：
 *  - 字符串（直接作 lyric）
 *  - 对象 { lyric, tlyric, rlyric, lxlyric }（LX 音源标准结构）
 */
function extractLyric(result: unknown): { lyric: string; tlyric: string | null } | null {
  if (!result) return null
  if (typeof result === 'string') {
    const s = result.trim()
    return s ? { lyric: s, tlyric: null } : null
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>
    const lyric = obj.lyric != null ? String(obj.lyric).trim() : ''
    if (!lyric) return null
    const tlyricRaw = obj.tlyric != null ? String(obj.tlyric).trim() : ''
    return { lyric, tlyric: tlyricRaw || null }
  }
  return null
}

class MusicSourceManager {
  private instances: SimulatorInstance[] = []
  private initialized: boolean = false
  private configPath: string = ''
  private configHash: string | null = null
  // 简单内存缓存，降低重复请求频率
  private lyricCache: Map<string, { value: { lyric: string; tlyric: string | null }; expires: number }> = new Map()
  private picCache: Map<string, { value: Buffer | string; expires: number }> = new Map()
  private defaultCacheTtl = 60 * 60 * 1000 // 1 hour
  /** 单次 getMusicUrl 调用超时（仿照 getLyric 已有的 Promise.race 超时模式） */
  private readonly musicUrlTimeoutMs = 15_000
  /** 全音源×音质尝试总预算，超时直接放弃（避免上游全挂时客户端等待数分钟） */
  private readonly musicUrlTotalTimeoutMs = 45_000

  /** 给 Promise 加超时的通用辅助（超时后 reject，定时器清理） */
  private async withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null
    try {
      return await Promise.race([
        p,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${label}（${Math.round(timeoutMs / 1000)}s）`)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 检测配置文件是否改变
   */
  private checkConfigChanged(): boolean {
    const configPath = path.resolve(process.cwd(), 'config/music-sources.json')
    const currentHash = getFileHash(configPath)
    
    if (currentHash === null) {
      logger.warn('无法读取配置文件 hash')
      return false
    }

    const changed = this.configHash !== currentHash
    if (changed) {
      logger.info('检测到配置文件变更，将重新加载')
      this.configHash = currentHash
    }
    return changed
  }

  /**
   * 重置实例（清空旧实例以便重新初始化）
   */
  private resetInstances(): void {
    this.instances = []
    this.initialized = false
  }

  private initPromise: Promise<void> | null = null

  /**
   * 初始化音源管理器
   * 多次并发调用会复用同一个初始化 Promise，避免重复加载脚本
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('音源管理器已初始化')
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.doInitialize().finally(() => {
      this.initPromise = null
    })
    return this.initPromise
  }

  /**
   * 强制重建所有音源实例。
   * 供管理端 CRUD（增删改配置）后主动调用，使改动立即生效，
   * 无需等待下次播放/歌词/封面请求触发 MD5 懒重载。
   */
  async reload(): Promise<void> {
    logger.info('触发音源实例重建（管理端 CRUD）...')
    this.resetInstances()
    await this.initialize()
  }

  private async doInitialize(): Promise<void> {
    logger.info('开始初始化音源管理器...')

    // 读取配置文件
    const configPath = path.resolve(process.cwd(), 'config/music-sources.json')
    this.configPath = configPath
    this.configHash = getFileHash(configPath)
    
    let config

    try {
      config = ConfigValidator.loadConfig(configPath)
      logger.info(`加载配置文件成功，找到 ${config.sources.length} 个音源`)
    } catch (error) {
      // 配置文件缺失（首次部署/空 config 目录）按空配置处理，不阻断启动；
      // 其余错误（JSON 解析失败等）仍抛出
      const errMsg = error instanceof Error ? error.message : String(error)
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || /配置文件不存在/.test(errMsg)) {
        logger.warn(`配置文件不存在（${configPath}），按空配置启动`)
        config = { sources: [] }
      } else {
        logger.error('加载配置文件失败:', error)
        throw error
      }
    }

    // 过滤已启用的音源并按优先级排序
    const enabledSources = config.sources
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority)

    logger.info(`已启用 ${enabledSources.length} 个音源`)

    // 初始化每个音源
    for (const sourceConfig of enabledSources) {
      const startTime = Date.now()
      const instance: SimulatorInstance = {
        simulator: new LXEnvironmentSimulator(),
        config: {
          name: sourceConfig.name || sourceConfig.path,
          priority: sourceConfig.priority,
          enabled: sourceConfig.enabled,
          timeout: sourceConfig.timeout,
          pt: sourceConfig.pt,
        },
        initialized: false,
      }

      try {
        const scriptPath = path.resolve(process.cwd(), sourceConfig.path)
        logger.debug(`初始化音源: ${instance.config.name} (${scriptPath})`)

        const sourceInfo = await instance.simulator.loadScript(scriptPath)
        
        instance.initialized = true
        instance.initTime = Date.now() - startTime
        instance.sourceInfo = sourceInfo

        const supportedSources = Object.keys(sourceInfo.sources).join(', ')
        logger.info(
          `音源初始化成功: ${instance.config.name} ` +
          `[${instance.initTime}ms] 支持: ${supportedSources}`
        )

        this.instances.push(instance)
      } catch (error) {
        instance.error = error instanceof Error ? error.message : String(error)
        logger.error(`音源初始化失败: ${instance.config.name}`, error)
        
        // 不阻塞其他音源的初始化
        this.instances.push(instance)
      }
    }

    const successCount = this.instances.filter(i => i.initialized).length
    logger.info(`音源管理器初始化完成，成功: ${successCount}/${this.instances.length}`)

    this.initialized = true
  }

  /**
   * 获取音乐 URL（智能降级）
   * 依次尝试所有音源，支持音质降级
   * 支持配置文件热重载
   */
  async getMusicUrl(musicInfo: MusicInfo, requestedQuality: QualityType = '320k'): Promise<string> {
    // 在获取 URL 时检查配置是否变更
    if (this.initialized && this.checkConfigChanged()) {
      logger.info('配置文件已变更，重新加载音源...')
      this.resetInstances()
    }

    if (!this.initialized) {
      await this.initialize()
    }

    let availableInstances = this.instances.filter(i => i.initialized)

    // 如果当前没有可用实例，尝试重新加载配置并初始化一次
    if (availableInstances.length === 0) {
      logger.warn('当前没有已初始化的音源，尝试重新加载配置并初始化...')
      this.resetInstances()
      await this.initialize()

      availableInstances = this.instances.filter(i => i.initialized)
      if (availableInstances.length === 0) {
        throw new Error('没有可用的音源')
      }
    }

    // 音质降级顺序
    const qualityFallback: QualityType[] = ['flac24bit', 'flac', '320k', '128k']
    const startIndex = qualityFallback.indexOf(requestedQuality)
    const qualitiesToTry = startIndex >= 0 
      ? qualityFallback.slice(startIndex)
      : [requestedQuality, ...qualityFallback]

    logger.debug(`获取音乐URL: ${musicInfo.name} - ${musicInfo.singer}`)
    logger.debug(`音源: ${musicInfo.source}, 请求音质: ${requestedQuality}`)

    // 总预算：全音源×音质尝试不无限串行（上游全挂时限制客户端等待时间）
    const deadline = Date.now() + this.musicUrlTotalTimeoutMs

    // 尝试所有音源和音质组合
    outer: for (const instance of availableInstances) {
      // pt 优先：用户配置的 pt 未包含该平台则跳过（即使脚本声明支持）
      if (!this.isAllowedByPt(instance, musicInfo.source)) {
        continue
      }
      // 检查该音源是否支持当前歌曲的音源平台
      if (!instance.sourceInfo?.sources[musicInfo.source]) {
        logger.debug(`${instance.config.name} 不支持音源: ${musicInfo.source}`)
        continue
      }

      const sourceConfig = instance.sourceInfo.sources[musicInfo.source]
      
      // 检查是否支持 musicUrl 操作
      if (!sourceConfig.actions.includes('musicUrl')) {
        logger.debug(`${instance.config.name} 不支持 musicUrl 操作`)
        continue
      }

      // 尝试不同音质
      for (const quality of qualitiesToTry) {
        // 总超时：超出预算立即放弃整个尝试
        if (Date.now() > deadline) break outer

        // 检查音源是否支持该音质
        if (!sourceConfig.qualitys.includes(quality)) {
          continue
        }

        // 检查歌曲是否有该音质
        if (!musicInfo._types[quality]) {
          continue
        }

        try {
          logger.debug(
            `尝试: ${instance.config.name} - ${musicInfo.source} - ${quality}`
          )

          // 单次调用加超时（洛雪脚本挂起时不阻塞整个请求）
          const url = await this.withTimeout(
            instance.simulator.getMusicUrl(musicInfo.source, musicInfo, quality),
            this.musicUrlTimeoutMs,
            `获取音乐URL超时: ${instance.config.name} - ${quality}`,
          )

          if (url && typeof url === 'string' && url.trim()) {
            logger.info(
              `获取成功: ${instance.config.name} - ${quality} - ${musicInfo.name}`
            )
            return url
          }
        } catch (error) {
          logger.debug(
            `获取失败: ${instance.config.name} - ${quality}`,
            error instanceof Error ? error.message : error
          )
        }
      }
    }

    // 所有音源都失败
    if (Date.now() > deadline) {
      throw new Error('无法获取播放链接: 所有音源均失败（总超时）')
    }
    throw new Error(`无法获取播放链接: 所有音源均失败 (歌曲: ${musicInfo.name})`)
  }

  /**
   * 从已加载的音源按优先级尝试获取歌词
   * 返回 { lyric, tlyric } 或 null。兼容音源返回的字符串或 {lyric, tlyric, ...} 对象。
   */
  async getLyric(musicInfo: MusicInfo, timeoutMs = 5000): Promise<{ lyric: string; tlyric: string | null } | null> {
    try {
      if (this.initialized && this.checkConfigChanged()) {
        this.resetInstances()
      }
      if (!this.initialized) await this.initialize()

      const key = `lyric:${musicInfo.songmid || musicInfo.name}`
      const now = Date.now()
      const cached = this.lyricCache.get(key)
      if (cached && cached.expires > now) return cached.value

      const available = this.instances.filter(i => i.initialized)
      if (available.length === 0) return null

      // 音源脚本的歌词方法签名统一为 (source, musicInfo)（见 music-core/index.js getLyric）
      const candidateNames = ['getLyric', 'getLyricInfo', 'lyrics', 'lyric']
      type AnyFunction = (...args: unknown[]) => unknown

      for (const instance of available) {
        if (!this.isAllowedByPt(instance, musicInfo.source)) continue
        if (!instance.sourceInfo?.sources[musicInfo.source]) continue

        for (const fnName of candidateNames) {
          const simRec = instance.simulator as unknown as Record<string, unknown>
          const fn = simRec[fnName] as AnyFunction | undefined
          if (typeof fn !== 'function') continue

          try {
            const result = await Promise.race([
              Promise.resolve(fn.call(instance.simulator, musicInfo.source, musicInfo)),
              new Promise((_res, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
            ]) as unknown

            const extracted = extractLyric(result)
            if (extracted) {
              this.lyricCache.set(key, { value: extracted, expires: Date.now() + this.defaultCacheTtl })
              logger.info(`getLyric: 从 ${instance.config.name}.${fnName} 获取到歌词，len=${extracted.lyric.length}`)
              return extracted
            }
          } catch (err) {
            logger.debug(`getLyric: ${instance.config.name}.${fnName} 调用失败:`, err instanceof Error ? err.message : err)
          }
        }
      }

      return null
    } catch (err) {
      logger.warn('getLyric error:', err)
      return null
    }
  }

  /**
   * 从已加载的音源按优先级尝试获取封面（返回 Buffer | URL string | null）
   */
  async getPic(musicInfo: MusicInfo, timeoutMs = 5000): Promise<Buffer | string | null> {
    try {
      if (this.initialized && this.checkConfigChanged()) {
        this.resetInstances()
      }
      if (!this.initialized) await this.initialize()

      const key = `pic:${musicInfo.songmid || musicInfo.name}`
      const now = Date.now()
      const cached = this.picCache.get(key)
      if (cached && cached.expires > now) return cached.value

      const available = this.instances.filter(i => i.initialized)
      if (available.length === 0) return null

      const candidateNames = ['getPic', 'getPicPath', 'pic', 'cover']
      type AnyFunction = (...args: unknown[]) => unknown

      for (const instance of available) {
        if (!this.isAllowedByPt(instance, musicInfo.source)) continue
        if (!instance.sourceInfo?.sources[musicInfo.source]) continue

        for (const fnName of candidateNames) {
          const simRec = instance.simulator as unknown as Record<string, unknown>
          const fn = simRec[fnName] as AnyFunction | undefined
          if (typeof fn !== 'function') continue

          try {
            const attempt1 = Promise.resolve(fn.call(instance.simulator, musicInfo))
            const attempt2 = Promise.resolve(fn.call(instance.simulator, musicInfo.source, musicInfo))

            const raced = await Promise.race([
              attempt1,
              attempt2,
              new Promise((_res, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
            ]) as unknown
            const result = raced as unknown

            if (!result) continue

            // Buffer-like
            if (Buffer.isBuffer(result)) {
              this.picCache.set(key, { value: result, expires: Date.now() + this.defaultCacheTtl })
              logger.info(`getPic: 从 ${instance.config.name}.${fnName} 获取到 Buffer，size=${result.length}`)
              return result
            }

            if (typeof result === 'string') {
              const s = result.trim()
              // data URI
              if (s.startsWith('data:')) {
                const comma = s.indexOf(',')
                if (comma > 0) {
                  const b64 = s.slice(comma + 1)
                  const buf = Buffer.from(b64, 'base64')
                  this.picCache.set(key, { value: buf, expires: Date.now() + this.defaultCacheTtl })
                  return buf
                }
              }

              // URL-like
              if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('//')) {
                this.picCache.set(key, { value: s, expires: Date.now() + this.defaultCacheTtl })
                logger.info(`getPic: 从 ${instance.config.name}.${fnName} 获取到图片 URL`)
                return s
              }

              // 其他字符串，可能是相对路径或自定义标识，直接返回
              this.picCache.set(key, { value: s, expires: Date.now() + this.defaultCacheTtl })
              return s
            }
          } catch (err) {
            logger.debug(`getPic: ${instance.config.name}.${fnName} 调用失败:`, err instanceof Error ? err.message : err)
          }
        }
      }

      return null
    } catch (err) {
      logger.warn('getPic error:', err)
      return null
    }
  }

  /**
   * 获取健康状态
   */
  getHealthStatus(): HealthStatus[] {
    return this.instances.map(instance => {
      const status: HealthStatus = {
        source: instance.config.name,
        name: instance.config.name,
        enabled: instance.config.enabled,
        initialized: instance.initialized,
        initTime: instance.initTime,
        supportedSources: [],
        supportedActions: {},
        supportedQualities: {},
        error: instance.error,
      }

      if (instance.initialized && instance.sourceInfo) {
        status.supportedSources = Object.keys(instance.sourceInfo.sources)
        
        for (const [source, config] of Object.entries(instance.sourceInfo.sources)) {
          status.supportedActions[source] = config.actions
          status.supportedQualities[source] = config.qualitys
        }
      }

      return status
    })
  }

  /**
   * 检查管理器是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * pt 配置优先过滤
   * 若实例配置了 pt（非空），则只有 source 在 pt 内才允许；
   * 未配置 pt 时回退到 sourceInfo 判定（保持原有行为）。
   * 用于在脚本声明支持、但某平台实际失效时，通过 pt 手动排除。
   */
  private isAllowedByPt(instance: SimulatorInstance, source: string): boolean {
    const pt = instance.config.pt
    if (pt && pt.length > 0 && !pt.includes(source)) {
      logger.debug(`${instance.config.name} 的 pt 配置未包含音源: ${source}，跳过`)
      return false
    }
    return true
  }
}

// 单例实例
export const musicSourceManager = new MusicSourceManager()
