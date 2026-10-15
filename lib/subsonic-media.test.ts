import { describe, it, expect } from 'vitest'
import {
  resolveSubsonicMediaMeta,
  toDurationSeconds,
  QUALITY_FORMAT,
} from './subsonic-media'
import type { QualityInfo, QualityType } from './types/music'

function typesOf(...list: Array<[QualityType, string]>): QualityInfo[] {
  return list.map(([type, size]) => ({ type, size }))
}

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
  it('同时有 MP3 和无损时展示最高档，大小也取同一档', () => {
    const meta = resolveSubsonicMediaMeta({
      types: typesOf(['320k', '8M'], ['flac', '25M'], ['flac24bit', '50M']),
    })
    expect(meta).toEqual({
      quality: 'flac24bit', bitRate: undefined, size: 50 * 1024 * 1024,
      suffix: 'flac', contentType: 'audio/flac',
    })
  })

  it('仅有 MP3：选择最高档，size 从 _types 换算字节', () => {
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

  it('默认选择最高支持档位 FLAC', () => {
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
