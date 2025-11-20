/**
 * 音源管理服务
 * 管理多个 LXEnvironmentSimulator 实例，提供智能 URL 获取
 */

import path from 'path'
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
  }
  initialized: boolean
  initTime?: number
  sourceInfo?: SourceInfo
  error?: string
}

class MusicSourceManager {
  private instances: SimulatorInstance[] = []
  private initialized: boolean = false

  /**
   * 初始化音源管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('音源管理器已初始化，跳过')
      return
    }

    logger.info('开始初始化音源管理器...')

    // 读取配置文件
    const configPath = path.resolve(process.cwd(), 'config/music-sources.json')
    let config

    try {
      config = ConfigValidator.loadConfig(configPath)
      logger.info(`加载配置文件成功，找到 ${config.sources.length} 个音源`)
    } catch (error) {
      logger.error('加载配置文件失败:', error)
      throw error
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
   */
  async getMusicUrl(musicInfo: MusicInfo, requestedQuality: QualityType = '320k'): Promise<string> {
    if (!this.initialized) {
      await this.initialize()
    }

    const availableInstances = this.instances.filter(i => i.initialized)
    
    if (availableInstances.length === 0) {
      throw new Error('没有可用的音源')
    }

    // 音质降级顺序
    const qualityFallback: QualityType[] = ['flac24bit', 'flac', '320k', '128k']
    const startIndex = qualityFallback.indexOf(requestedQuality)
    const qualitiesToTry = startIndex >= 0 
      ? qualityFallback.slice(startIndex)
      : [requestedQuality, ...qualityFallback]

    logger.debug(`获取音乐URL: ${musicInfo.name} - ${musicInfo.singer}`)
    logger.debug(`音源: ${musicInfo.source}, 请求音质: ${requestedQuality}`)

    // 尝试所有音源和音质组合
    for (const instance of availableInstances) {
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

          const url = await instance.simulator.getMusicUrl(
            musicInfo.source,
            musicInfo,
            quality
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
    throw new Error(`无法获取播放链接: 所有音源均失败 (歌曲: ${musicInfo.name})`)
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
}

// 单例实例
export const musicSourceManager = new MusicSourceManager()
