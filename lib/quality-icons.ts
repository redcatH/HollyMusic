/**
 * 音乐品质和音源图标配置
 */

export type QualityType = 'flac24bit' | 'flac' | '320k' | '128k' | 'unknown'
export type SourceType = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'unknown'

// 品质信息映射表
export const QUALITY_MAP: Record<QualityType, { icon: string; label: string; color: string }> = {
  'flac24bit': {
    icon: '🎵', // 可以替换为实际图标
    label: 'FLAC 24bit',
    color: 'text-red-500',
  },
  'flac': {
    icon: '♪',
    label: 'FLAC',
    color: 'text-purple-500',
  },
  '320k': {
    icon: '◆',
    label: '320K',
    color: 'text-blue-500',
  },
  '128k': {
    icon: '●',
    label: '128K',
    color: 'text-gray-500',
  },
  'unknown': {
    icon: '○',
    label: '未知',
    color: 'text-gray-400',
  },
}

// 音源信息映射表
export const SOURCE_MAP: Record<SourceType, { icon: string; label: string; color: string }> = {
  'kw': {
    icon: '🎵',
    label: '酷我',
    color: 'text-blue-600',
  },
  'kg': {
    icon: '🎼',
    label: '酷狗',
    color: 'text-yellow-600',
  },
  'tx': {
    icon: '🎶',
    label: 'QQ音乐',
    color: 'text-green-600',
  },
  'wy': {
    icon: '♫',
    label: '网易云',
    color: 'text-red-600',
  },
  'mg': {
    icon: '🎤',
    label: '咪咕',
    color: 'text-pink-600',
  },
  'unknown': {
    icon: '?',
    label: '未知',
    color: 'text-gray-500',
  },
}

/**
 * 获取品质信息
 */
export function getQualityInfo(quality: QualityType) {
  return QUALITY_MAP[quality] || QUALITY_MAP.unknown
}

/**
 * 获取音源信息
 */
export function getSourceInfo(source: SourceType) {
  return SOURCE_MAP[source] || SOURCE_MAP.unknown
}

/**
 * 解析品质类型
 */
export function parseQuality(qualityStr?: string): QualityType {
  if (!qualityStr) return 'unknown'
  
  const lower = qualityStr.toLowerCase()
  if (lower.includes('24bit') || lower.includes('24-bit')) return 'flac24bit'
  if (lower.includes('flac')) return 'flac'
  if (lower.includes('320')) return '320k'
  if (lower.includes('128')) return '128k'
  
  return 'unknown'
}

/**
 * 解析音源类型
 */
export function parseSource(sourceStr?: string): SourceType {
  if (!sourceStr) return 'unknown'
  
  const lower = sourceStr.toLowerCase()
  if (lower.includes('kw') || lower.includes('kuwo')) return 'kw'
  if (lower.includes('kg') || lower.includes('kugou')) return 'kg'
  if (lower.includes('tx') || lower.includes('qq') || lower.includes('tencent')) return 'tx'
  if (lower.includes('wy') || lower.includes('netease') || lower.includes('网易')) return 'wy'
  if (lower.includes('mg') || lower.includes('migu')) return 'mg'
  
  return 'unknown'
}
