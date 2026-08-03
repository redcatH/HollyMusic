import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectCodecCap, capQuality } from './codec-support'

describe('capQuality', () => {
  it('q 高于 cap → 压到 cap', () => {
    expect(capQuality('flac24bit', '320k')).toBe('320k')
    expect(capQuality('flac', '320k')).toBe('320k')
    expect(capQuality('flac24bit', 'flac')).toBe('flac')
  })

  it('q 低于或等于 cap → 不变', () => {
    expect(capQuality('128k', '320k')).toBe('128k')
    expect(capQuality('flac', 'flac24bit')).toBe('flac')
    expect(capQuality('flac', 'flac')).toBe('flac')
  })
})

describe('detectCodecCap', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('SSR（无 window/document）→ 不限制 flac24bit', () => {
    expect(detectCodecCap()).toBe('flac24bit')
  })

  it('canPlayType 明确不支持 FLAC（空串）→ 压到 320k', () => {
    const canPlayType = vi.fn(() => '')
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { createElement: () => ({ canPlayType }) })
    expect(detectCodecCap()).toBe('320k')
    expect(canPlayType).toHaveBeenCalled()
  })

  it('canPlayType 返回 maybe/probably → 不限制 flac24bit', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {
      createElement: () => ({
        canPlayType: (t: string) => (t.includes('flac') ? 'maybe' : ''),
      }),
    })
    expect(detectCodecCap()).toBe('flac24bit')
  })
})
