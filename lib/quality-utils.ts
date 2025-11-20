/**
 * 品质排序和处理工具
 */

export type QualityLevel = 'flac24bit' | 'flac' | '320k' | '192k' | '128k' | 'unknown'

// 品质优先级（从高到低）
const QUALITY_PRIORITY: Record<string, number> = {
  'flac24bit': 5,
  'flac': 4,
  '320k': 3,
  '320': 3,
  '192k': 2,
  '192': 2,
  '128k': 1,
  '128': 1,
}

/**
 * 从多个品质中选择最高品质
 */
export function getBestQuality(types?: Array<{ type: string; size: string }>): QualityLevel {
  if (!types || types.length === 0) {
    return 'unknown'
  }

  if (types.length === 1) {
    return parseQuality(types[0].type)
  }

  // 按优先级排序，选择最高品质
  let bestQuality = types[0]
  let bestPriority = QUALITY_PRIORITY[types[0].type.toLowerCase()] || 0

  for (const type of types) {
    const priority = QUALITY_PRIORITY[type.type.toLowerCase()] || 0
    if (priority > bestPriority) {
      bestQuality = type
      bestPriority = priority
    }
  }

  return parseQuality(bestQuality.type)
}

/**
 * 解析品质类型
 */
export function parseQuality(qualityStr?: string): QualityLevel {
  if (!qualityStr) return 'unknown'
  
  const lower = qualityStr.toLowerCase()
  if (lower.includes('24bit') || lower.includes('24-bit')) return 'flac24bit'
  if (lower.includes('flac')) return 'flac'
  if (lower.includes('320')) return '320k'
  if (lower.includes('192')) return '192k'
  if (lower.includes('128')) return '128k'
  
  return 'unknown'
}
