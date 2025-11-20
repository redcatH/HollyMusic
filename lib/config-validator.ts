/**
 * 配置验证器
 * 验证音源配置文件的格式和有效性
 */

import fs from 'fs'
import path from 'path'
import type { MusicSourcesConfig, SourceConfig } from './types/music'
import { logger } from './logger'

export class ConfigValidator {
  /**
   * 验证配置文件
   */
  static validate(config: unknown): MusicSourcesConfig {
    if (!config || typeof config !== 'object') {
      throw new Error('配置文件格式无效：必须是一个对象')
    }

    const cfg = config as Record<string, unknown>

    if (!Array.isArray(cfg.sources)) {
      throw new Error('配置文件格式无效：sources 必须是一个数组')
    }

    const validatedSources: SourceConfig[] = []

    for (let i = 0; i < cfg.sources.length; i++) {
      const source = cfg.sources[i]
      
      try {
        const validated = this.validateSource(source, i)
        validatedSources.push(validated)
      } catch (error) {
        logger.warn(`源配置 [${i}] 验证失败，已跳过:`, error)
      }
    }

    if (validatedSources.length === 0) {
      throw new Error('没有有效的音源配置')
    }

    return { sources: validatedSources }
  }

  /**
   * 验证单个音源配置
   */
  private static validateSource(source: unknown, index: number): SourceConfig {
    if (!source || typeof source !== 'object') {
      throw new Error(`源配置 [${index}] 必须是一个对象`)
    }

    const src = source as Record<string, unknown>

    // 验证必填字段
    if (typeof src.path !== 'string' || !src.path) {
      throw new Error(`源配置 [${index}] 缺少必填字段: path`)
    }

    if (typeof src.enabled !== 'boolean') {
      throw new Error(`源配置 [${index}] enabled 必须是布尔值`)
    }

    if (typeof src.priority !== 'number') {
      throw new Error(`源配置 [${index}] priority 必须是数字`)
    }

    // 验证文件路径存在性
    const scriptPath = path.resolve(process.cwd(), src.path)
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`源配置 [${index}] 脚本文件不存在: ${src.path}`)
    }

    // 构建验证后的配置
    const validated: SourceConfig = {
      path: src.path,
      enabled: src.enabled,
      priority: src.priority,
    }

    // 可选字段
    if (typeof src.timeout === 'number') {
      validated.timeout = src.timeout
    }

    if (typeof src.name === 'string') {
      validated.name = src.name
    }

    if (typeof src.description === 'string') {
      validated.description = src.description
    }

    return validated
  }

  /**
   * 读取并验证配置文件
   */
  static loadConfig(configPath: string): MusicSourcesConfig {
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }

    const content = fs.readFileSync(configPath, 'utf-8')
    
    let config: unknown
    try {
      config = JSON.parse(content)
    } catch (error) {
      throw new Error(`配置文件 JSON 解析失败: ${error}`)
    }

    return this.validate(config)
  }
}
