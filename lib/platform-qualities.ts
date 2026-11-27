import type { QualityInfo, QualityType } from './types/music'

export const TRACK_QUALITY_BATCH_SIZE = 8

export function mergeQualityInfos(current: QualityInfo[] | undefined, supplemental: QualityInfo[]): QualityInfo[] {
  if (!supplemental.length) return current ?? []
  const qualities = new Map(current?.map(item => [item.type, item]))
  for (const item of supplemental) {
    const previous = qualities.get(item.type)
    qualities.set(item.type, { ...previous, ...item, size: item.size || previous?.size || '' })
  }
  return [...qualities.values()]
}

export function formatQualityBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(2) + 'M'
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + 'K'
  return bytes + 'B'
}

export function qualityFromBytes(type: QualityType, bytes: unknown, hash?: string): QualityInfo | null {
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) return null
  return { type, size: formatQualityBytes(bytes), sizeBytes: bytes, ...(hash ? { hash } : {}) }
}

export function qqExtendedQualities(sizes: unknown): QualityInfo[] {
  if (!Array.isArray(sizes)) return []
  const types = ['master', 'atmos', 'atmos_plus'] as const
  return types.map((type, index) => qualityFromBytes(type, sizes[index])).filter(entry => entry !== null)
}

type NetEaseQuality = { size?: number }

export function neteaseExtendedQualities(song: { hr?: NetEaseQuality; je?: NetEaseQuality; jm?: NetEaseQuality; db?: NetEaseQuality }): QualityInfo[] {
  return [
    qualityFromBytes('flac24bit', song.hr?.size || song.je?.size),
    qualityFromBytes('master', song.jm?.size),
    qualityFromBytes('atmos', song.db?.size),
  ].filter(entry => entry !== null)
}
