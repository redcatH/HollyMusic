/**
 * 播放音质选择的规范常量与工具（针对 lib/types/music.ts 的 QualityType）。
 *
 * 与 quality-utils.ts 的 QualityLevel（含 192k/unknown，供 QualityBadge 能力标签）
 * 刻意分离：本模块只关心播放器「用户偏好 + 实际播放」的音质决策。
 */
import type { QualityInfo, QualityType } from '@/lib/types/music'
import { PLAYBACK_QUALITIES } from '@/lib/playback-protocol'

/** 合法音质，按从高到低排序（index 0 = 最高） */
export const QUALITY_ORDER: QualityType[] = ['master', 'flac24bit', 'flac', '320k', '128k']
export const SURROUND_QUALITIES: QualityType[] = ['atmos_plus', 'atmos']

/** 合法音质集合（用于校验 localStorage 持久化值） */
export const VALID_QUALITIES: QualityType[] = [...PLAYBACK_QUALITIES]

export function isQuality(value: unknown): value is QualityType {
  return VALID_QUALITIES.some(quality => quality === value)
}

/** 音质按钮 / 标签的简短文案 */
export const QUALITY_LABEL: Record<QualityType, string> = {
  '320k': '320K',
  '128k': '128K',
  flac: 'FLAC',
  flac24bit: 'Hi-Res',
  master: '母带',
  atmos: '空间混音',
  atmos_plus: '六声道版',
}

/** 音质的完整描述（下拉菜单副标题） */
export const QUALITY_TITLE: Record<QualityType, string> = {
  '320k': '320K 高品质',
  '128k': '128K 标准',
  flac: 'FLAC 无损',
  flac24bit: 'Hi-Res 无损',
  master: '母带音质',
  atmos: '空间混音版',
  atmos_plus: '六声道版',
}

/**
 * 从歌曲 types 提取支持的音质，按从高到低返回。
 * types 为空 / 异常时返回 []（调用方自行回退）。
 */
export function getAvailableQualities(types?: QualityInfo[]): QualityType[] {
  if (!types || types.length === 0) return []
  const present = new Set<QualityType>()
  for (const t of types) {
    if (t && isQuality(t.type)) {
      present.add(t.type)
    }
  }
  return [...QUALITY_ORDER, ...SURROUND_QUALITIES].filter(q => present.has(q))
}

/**
 * 给定用户偏好与歌曲支持列表，返回应实际播放的音质。
 *  - 偏好∈支持 → 偏好
 *  - 否则取支持中 ≤ 偏好 的最高档（就近降级）
 *  - 若支持的都高于偏好 → 取支持的最低档（保证能播，避免服务端因 _types 缺失抛错）
 *  - 支持列表为空（数据异常）→ 返回 preference，交由服务端降级 / 报错
 */
export function resolveQuality(preference: QualityType, types?: QualityInfo[]): QualityType {
  const available = getAvailableQualities(types).filter(q => QUALITY_ORDER.includes(q) && (q !== 'master' || preference === 'master'))
  if (SURROUND_QUALITIES.includes(preference)) return preference
  if (available.length === 0) return preference
  if (available.includes(preference)) return preference
  const prefIdx = QUALITY_ORDER.indexOf(preference) // preference 合法时必 >= 0
  const lowerOrEqual = available.filter(q => QUALITY_ORDER.indexOf(q) >= prefIdx)
  if (lowerOrEqual.length > 0) return lowerOrEqual[0] // 最高且 ≤ 偏好
  return available[available.length - 1] // 全部高于偏好 → 最低档
}

/** 取某音质在 types 中的文件大小（无则 undefined），供 UI 展示 */
export function getSizeOf(types: QualityInfo[] | undefined, q: QualityType): string | undefined {
  return types?.find(t => t.type === q)?.size
}

/**
 * 返回比给定音质低一档的音质（用于解码失败时降级重试）。
 * 已是最低档（128k）时返回 null。QUALITY_ORDER 已是高→低，故降级 = index + 1。
 *
 * 刻意不看 types：降级的目的是「换一种浏览器能解的格式」（如 FLAC→MP3），
 * 即便歌曲不支持该档，服务端 getMusicUrl 也会继续降级到可播的 MP3，故无需在此过滤。
 */
export function nextLowerQuality(q: QualityType): QualityType | null {
  const idx = QUALITY_ORDER.indexOf(q)
  if (idx < 0 || idx >= QUALITY_ORDER.length - 1) return null
  return QUALITY_ORDER[idx + 1]
}
