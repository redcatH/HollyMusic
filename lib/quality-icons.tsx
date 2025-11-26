import React from 'react'
// use standard <img> for icons from public/ to avoid requiring width/height
export type QualityType = 'flac24bit' | 'flac' | '320k' | '192k' | '128k' | 'unknown'
export type SourceType = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'unknown'

export const QUALITY_MAP: Record<QualityType, { icon: React.ReactNode; label: string; color: string }> = {
  'flac24bit': {
    icon: <span>🎵</span>,
    label: 'FLAC 24bit',
    color: 'text-red-500',
  },
  'flac': {
    icon: <span>♪</span>,
    label: 'FLAC',
    color: 'text-purple-500',
  },
  '320k': {
    icon: <span>◆</span>,
    label: '320K',
    color: 'text-blue-500',
  },
  '192k': {
    icon: <span>◇</span>,
    label: '192K',
    color: 'text-cyan-500',
  },
  '128k': {
    icon: <span>●</span>,
    label: '128K',
    color: 'text-gray-500',
  },
  'unknown': {
    icon: <span>○</span>,
    label: '未知',
    color: 'text-gray-400',
  },
}

export const SOURCE_MAP: Record<SourceType, { icon: React.ReactNode; label: string; color: string }> = {
  'kw': {
    icon: <img src="/icons/kw.svg" className="h-4 w-4" alt="酷我" />,
    label: '酷我',
    color: 'text-blue-600',
  },
  'kg': {
    icon: <img src="/icons/kg.svg" className="h-4 w-4" alt="酷狗" />,
    label: '酷狗',
    color: 'text-yellow-600',
  },
  'tx': {
    icon: <img src="/icons/tx.svg" className="h-4 w-4" alt="QQ音乐" />,
    label: 'QQ音乐',
    color: 'text-green-600',
  },
  'wy': {
    icon: <img src="/icons/wy.svg" className="h-4 w-4" alt="网易云" />,
    label: '网易云',
    color: 'text-red-600',
  },
  'mg': {
    icon: <img src="/icons/mg.svg" className="h-4 w-4" alt="咪咕" />,
    label: '咪咕',
    color: 'text-pink-600',
  },
  'unknown': {
    icon: <img src="/icons/unknown.svg" className="h-4 w-4" alt="未知" />,
    label: '未知',
    color: 'text-gray-500',
  },
}

export function getQualityInfo(quality: QualityType) {
  return QUALITY_MAP[quality] || QUALITY_MAP.unknown
}

export function getSourceInfo(source: SourceType) {
  return SOURCE_MAP[source] || SOURCE_MAP.unknown
}

export function parseQuality(qualityStr?: string): QualityType {
  if (!qualityStr) return 'unknown'
  const lower = qualityStr.toLowerCase()
  if (lower.includes('24bit') || lower.includes('24-bit')) return 'flac24bit'
  if (lower.includes('flac')) return 'flac'
  if (lower.includes('320')) return '320k'
  if (lower.includes('128')) return '128k'
  return 'unknown'
}

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
