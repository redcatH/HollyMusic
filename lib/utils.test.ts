import { describe, it, expect } from 'vitest'
import { normalizeSizeToBytes } from './utils'

describe('normalizeSizeToBytes', () => {
  it('单字母单位（music-core sizeFormate 的真实产出格式）', () => {
    expect(normalizeSizeToBytes('8.7M')).toBe(String(Math.floor(8.7 * 1024 ** 2))) // 9122611
    expect(normalizeSizeToBytes('1.02G')).toBe(String(Math.floor(1.02 * 1024 ** 3))) // 1095216660
    expect(normalizeSizeToBytes('512K')).toBe(String(512 * 1024))
    expect(normalizeSizeToBytes('2T')).toBe(String(Math.floor(2 * 1024 ** 4)))
    expect(normalizeSizeToBytes('0B')).toBe('0')
  })

  it('双字母单位（向后兼容旧格式）', () => {
    expect(normalizeSizeToBytes('8.70 MB')).toBe(String(Math.floor(8.7 * 1024 ** 2)))
    expect(normalizeSizeToBytes('1024KB')).toBe(String(1024 * 1024))
    expect(normalizeSizeToBytes('1.5GB')).toBe(String(Math.floor(1.5 * 1024 ** 3)))
  })

  it('纯数字与数字输入', () => {
    expect(normalizeSizeToBytes('12345')).toBe('12345')
    expect(normalizeSizeToBytes('12,345')).toBe('12345')
    expect(normalizeSizeToBytes(123.9)).toBe('123')
  })

  it('无效输入 → 0', () => {
    expect(normalizeSizeToBytes(null)).toBe('0')
    expect(normalizeSizeToBytes(undefined)).toBe('0')
    expect(normalizeSizeToBytes('')).toBe('0')
    expect(normalizeSizeToBytes('abc')).toBe('0')
  })

  it('无法识别单位的字符串走数字兜底（保持旧行为）', () => {
    expect(normalizeSizeToBytes('12.3XYZ')).toBe('12')
  })
})
