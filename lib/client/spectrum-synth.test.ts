import { describe, it, expect } from 'vitest'
import { spectrumSynth, SPECTRUM_SYNTH_BINS } from './spectrum-synth'

/** 多个采样时间戳的平均包络，抹平单帧的波浪调制，只看频段间的能量趋势。 */
function averageEnvelope(bins: number, samples: number): { low: number; high: number } {
  let low = 0
  let high = 0
  const data = new Uint8Array(bins)
  for (let s = 0; s < samples; s++) {
    spectrumSynth(data, s * 200)
    for (let i = 0; i < bins; i++) {
      // 柱条渲染只取前 68% 频段，低/高分段也按此口径比较。
      if (i < bins * 0.34) low += data[i]
      else if (i >= bins * 0.34 && i < bins * 0.68) high += data[i]
    }
  }
  const lowBins = Math.floor(bins * 0.34)
  const highBins = Math.floor(bins * 0.68) - lowBins
  return { low: low / (samples * lowBins), high: high / (samples * highBins) }
}

describe('spectrumSynth', () => {
  it('输出值域始终在 [0, 255]', () => {
    const data = new Uint8Array(SPECTRUM_SYNTH_BINS)
    for (let s = 0; s < 200; s++) {
      spectrumSynth(data, s * 137.5)
      for (const v of data) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(255)
      }
    }
  })

  it('能量包络低频重、高频轻（多帧平均）', () => {
    const { low, high } = averageEnvelope(SPECTRUM_SYNTH_BINS, 120)
    expect(low).toBeGreaterThan(high)
    // 包络为 (1-bin)^0.65：低频段均值应明显高于高频段，而非勉强相等。
    expect(low).toBeGreaterThan(high * 1.3)
  })

  it('相同时间戳输出完全确定（无真随机）', () => {
    const a = new Uint8Array(SPECTRUM_SYNTH_BINS)
    const b = new Uint8Array(SPECTRUM_SYNTH_BINS)
    spectrumSynth(a, 12345.678)
    spectrumSynth(b, 12345.678)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('不同时间戳输出不同（动画在动）', () => {
    const a = new Uint8Array(SPECTRUM_SYNTH_BINS)
    const b = new Uint8Array(SPECTRUM_SYNTH_BINS)
    spectrumSynth(a, 0)
    spectrumSynth(b, 500)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})
