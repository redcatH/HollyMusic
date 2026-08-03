import { describe, it, expect } from 'vitest'
import { resolveQuality, getAvailableQualities } from './quality-options'
import type { QualityInfo, QualityType } from './types/music'

/** 快速构造 types 数组 */
const types = (...qs: QualityType[]): QualityInfo[] => qs.map(q => ({ type: q, size: '1M' }))

describe('resolveQuality - 偏好高于歌曲支持时必须降级到可播放档', () => {
  it('偏好∈支持 → 用偏好', () => {
    expect(resolveQuality('320k', types('128k', '320k', 'flac'))).toBe('320k')
  })

  it('偏好 Hi-Res，歌曲仅 [320k,128k] → 降级到 320k', () => {
    expect(resolveQuality('flac24bit', types('320k', '128k'))).toBe('320k')
  })

  it('偏好 FLAC，歌曲仅 [320k,128k] → 降级到 320k', () => {
    expect(resolveQuality('flac', types('320k', '128k'))).toBe('320k')
  })

  it('偏好 320k，歌曲仅 [128k] → 降级到 128k', () => {
    expect(resolveQuality('320k', types('128k'))).toBe('128k')
  })

  it('偏好 Hi-Res，歌曲仅 [128k] → 降级到 128k（不会返回不支持的高档）', () => {
    expect(resolveQuality('flac24bit', types('128k'))).toBe('128k')
  })

  it('偏好低于所有支持档 → 取最低档（保证能播，不报错）', () => {
    // 偏好 128k，但歌曲只有无损 → 取 flac（最接近的可用档）
    expect(resolveQuality('128k', types('flac', 'flac24bit'))).toBe('flac')
  })

  it('types 为空/缺失 → 返回偏好（交服务端 getMusicUrl 降级兜底）', () => {
    expect(resolveQuality('flac24bit', [])).toBe('flac24bit')
    expect(resolveQuality('flac24bit', undefined)).toBe('flac24bit')
  })

  it('降级结果一定落在歌曲支持范围内（除 types 空的兜底分支）', () => {
    const supported = types('128k', '320k')
    const result = resolveQuality('flac24bit', supported)
    expect(supported.some(t => t.type === result)).toBe(true)
  })
})

describe('getAvailableQualities', () => {
  it('按高→低返回支持的音质', () => {
    expect(getAvailableQualities(types('128k', '320k'))).toEqual(['320k', '128k'])
  })

  it('types 空 → 返回空数组', () => {
    expect(getAvailableQualities([])).toEqual([])
    expect(getAvailableQualities(undefined)).toEqual([])
  })
})
