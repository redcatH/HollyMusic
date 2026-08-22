import { describe, it, expect } from 'vitest'
import {
  selectQuality,
  resolveSubsonicMediaMeta,
  toDurationSeconds,
  QUALITY_FORMAT,
} from './subsonic-media'
import type { QualityInfo, QualityType } from './types/music'

function typesOf(...list: Array<[QualityType, string]>): QualityInfo[] {
  return list.map(([type, size]) => ({ type, size }))
}

describe('selectQuality（自 stream 迁出，行为必须等价）', () => {
  it('请求档位受支持 → 直接返回', () => {
    expect(selectQuality('320k', ['128k', '320k'])).toBe('320k')
  })

  it('请求档位不支持 → 按高→低回退链取第一个支持的（可能高于请求档）', () => {
    // 320k 不支持、有 flac → 升到 flac（与 stream 实际行为一致）
    expect(selectQuality('320k', ['flac', '128k'])).toBe('flac')
    // 320k/flac 都不支持 → 128k
    expect(selectQuality('320k', ['128k'])).toBe('128k')
    // 请求 128k 但只有无损 → 回退链取 flac24bit 优先
    expect(selectQuality('128k', ['flac24bit', 'flac'])).toBe('flac24bit')
  })

  it('回退按高→低固定顺序扫描，与列表顺序无关', () => {
    // 请求 320k 不在列表 → 应取列表中的最高档 flac24bit（而非列表第一个）
    expect(selectQuality('320k', ['128k', 'flac24bit', 'flac'])).toBe('flac24bit')
    expect(selectQuality('320k', ['flac', 'flac24bit'])).toBe('flac24bit')
  })

  it('全不支持 → 第一个可用', () => {
    expect(selectQuality('320k', ['128k'])).toBe('128k')
  })
})

describe('QUALITY_FORMAT', () => {
  it('有损档位给真实码率 + mp3', () => {
    expect(QUALITY_FORMAT['320k']).toEqual({ bitRate: 320, suffix: 'mp3', contentType: 'audio/mpeg' })
    expect(QUALITY_FORMAT['128k']).toEqual({ bitRate: 128, suffix: 'mp3', contentType: 'audio/mpeg' })
  })

  it('无损档位省略 bitRate（真实码率未知，不编造）+ flac', () => {
    expect(QUALITY_FORMAT.flac).toEqual({ suffix: 'flac', contentType: 'audio/flac' })
    expect(QUALITY_FORMAT.flac24bit).toEqual({ suffix: 'flac', contentType: 'audio/flac' })
    expect(QUALITY_FORMAT.flac.bitRate).toBeUndefined()
  })
})

describe('resolveSubsonicMediaMeta', () => {
  it('MusicInfo 形态：默认目标 320k，size 从 _types 换算字节（单字母单位）', () => {
    const meta = resolveSubsonicMediaMeta({
      types: typesOf(['320k', '3.45M'], ['128k', '1.4M']),
      _types: { '320k': { size: '3.45M' }, '128k': { size: '1.4M' } },
    })
    expect(meta).toEqual({
      quality: '320k',
      bitRate: 320,
      size: 3617587, // 3.45 × 1024² 向下取整
      suffix: 'mp3',
      contentType: 'audio/mpeg',
    })
  })

  it('_types 缺失时 size 回退 types 数组中的同档 size', () => {
    const meta = resolveSubsonicMediaMeta({ types: typesOf(['128k', '8.7M']) })
    expect(meta.quality).toBe('128k')
    expect(meta.size).toBe(9122611)
  })

  it('仅有无损 → flac 档位，bitRate 省略', () => {
    const meta = resolveSubsonicMediaMeta({ types: typesOf(['flac', '26.5M']) })
    expect(meta).toEqual({
      quality: 'flac',
      bitRate: undefined,
      size: 27787264, // 26.5 × 1024²
      suffix: 'flac',
      contentType: 'audio/flac',
    })
  })

  it('320k 不支持但有 flac → 与 stream 回退一致升到 flac', () => {
    const meta = resolveSubsonicMediaMeta({ types: typesOf(['flac', '26.5M'], ['128k', '1.4M']) })
    expect(meta.quality).toBe('flac')
    expect(meta.suffix).toBe('flac')
  })

  it('Prisma 行形态：从 data JSON 列还原 types', () => {
    const row = {
      id: 1,
      data: JSON.stringify({ types: typesOf(['320k', '3.45M']), _types: { '320k': { size: '3.45M' } } }),
    }
    expect(resolveSubsonicMediaMeta(row).quality).toBe('320k')
    expect(resolveSubsonicMediaMeta(row).size).toBe(3617587)
  })

  it('Prisma 行形态：data 缺失时兜底 typesJson 列', () => {
    const row = { typesJson: JSON.stringify(typesOf(['128k', '1.4M'])) }
    expect(resolveSubsonicMediaMeta(row).quality).toBe('128k')
  })

  it('data JSON 损坏 → 不抛错，返回空', () => {
    expect(resolveSubsonicMediaMeta({ data: '{broken' })).toEqual({})
  })

  it('无有效音质数据 → 全部省略（不编造）', () => {
    expect(resolveSubsonicMediaMeta({})).toEqual({})
    expect(resolveSubsonicMediaMeta({ types: [] })).toEqual({})
    expect(resolveSubsonicMediaMeta({ types: [{ type: 'unknown' as QualityType, size: '1M' }] })).toEqual({})
    expect(resolveSubsonicMediaMeta(null)).toEqual({})
  })
})

describe('toDurationSeconds', () => {
  it('优先 durationSeconds 反范式列（>0 才可信）', () => {
    expect(toDurationSeconds({ durationSeconds: 200 })).toBe(200)
    expect(toDurationSeconds({ durationSeconds: 0 })).toBe(0)
  })

  it('列无效（历史数据恒 null）→ 解析 data JSON 的 interval', () => {
    expect(toDurationSeconds({ durationSeconds: null, data: '{"interval":"03:12"}' })).toBe(192)
    expect(toDurationSeconds({ data: '{"interval":"1:30:45"}' })).toBe(5445)
  })

  it('无任何数据 → 0，不抛错', () => {
    expect(toDurationSeconds({})).toBe(0)
    expect(toDurationSeconds(null)).toBe(0)
    expect(toDurationSeconds({ data: '{broken' })).toBe(0)
  })
})
