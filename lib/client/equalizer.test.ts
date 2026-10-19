import { describe, expect, it } from 'vitest'
import { defaultEqualizer, EQ_PRESETS, designEqualizer, designedResponse, filterQ, isBandAvailable, equalizerResponse, parseEqualizer, protectionDb, responseFrequencies } from './equalizer'

describe('EQ 配置与频响', () => {
  it('默认透明，频响与保护均为零', () => {
    const settings = { ...defaultEqualizer(), enabled: true }
    expect(Math.max(...equalizerResponse(settings.bands, 48000).map(Math.abs))).toBeLessThan(1e-8)
    expect(protectionDb(settings, 48000)).toBe(0)
  })
  it('损坏、越界、错误频段数量和未来版本回退默认', () => {
    for (const value of ['oops', '{}', JSON.stringify({ ...defaultEqualizer(), bands: [1] }), JSON.stringify({ ...defaultEqualizer(), preamp: 13 }), JSON.stringify({ version: 8 })]) {
      expect(parseEqualizer(value).settings).toEqual(defaultEqualizer())
    }
  })
  it('迁移旧配置，保留开关、参数与自定义，拒绝不匹配的预设标识', () => {
    const settings = { ...defaultEqualizer(), enabled: true, preamp: -4, bands: [1,2,3,4,5,6,5,4,3,2] }
    const config = parseEqualizer(JSON.stringify(settings))
    expect(config.version).toBe(1)
    expect(config.settings).toEqual({ ...settings, preset: 'custom' })
    expect(parseEqualizer(JSON.stringify(config))).toEqual(config)
  })
  it('单段中心增益符合 RBJ peaking 定义，正负响应对称', () => {
    const bands = Array(10).fill(0); bands[5] = 6
    expect(equalizerResponse(bands, 48000, new Float32Array([1000]))[0]).toBeCloseTo(6, 6)
    const positive = equalizerResponse(bands, 44100)
    const negative = equalizerResponse(bands.map(v => -v), 44100)
    expect(Math.max(...positive.map((v, i) => Math.abs(v + negative[i])))).toBeLessThan(1e-6)
  })
  it('保护考虑相邻滤波器叠加和手动增益，关闭后透明', () => {
    const settings = { ...defaultEqualizer(), enabled: true, bands: Array(10).fill(6), preamp: 3 }
    expect(protectionDb(settings, 48000)).toBeLessThanOrEqual(-9.5)
    const response = designedResponse(settings.bands, 48000)
    expect(Math.abs(Math.max(...response) + settings.preamp + protectionDb(settings, 48000) + 0.5)).toBeLessThan(0.02)
    expect(protectionDb({ ...settings, enabled: false }, 48000)).toBe(0)
    expect(protectionDb({ ...settings, autoPreamp: false }, 48000)).toBe(0)
  })
  it('全部系统预设有效，低采样率频响保持有限且不超 Nyquist', () => {
    for (const preset of EQ_PRESETS) {
      expect(preset.bands).toHaveLength(10)
      expect(equalizerResponse(preset.bands, 22050).every(Number.isFinite)).toBe(true)
    }
    expect(Math.max(...responseFrequencies(22050))).toBeLessThan(11025)
  })
})

describe('图形 EQ 校准', () => {
  it('高低频的半增益带宽均为一倍频程', () => {
    for (const rate of [44100, 48000, 96000]) EQ_PRESETS[0].bands.forEach((_, index) => {
      const f = [31,62,125,250,500,1000,2000,4000,8000,16000][index]
      const tangent = Math.tan(Math.PI * f / rate), q = filterQ(index, rate)
      const r = Math.sqrt(1 + 1 / (4 * q * q)) + 1 / (2 * q)
      expect(Math.log2(Math.atan(tangent * r) / Math.atan(tangent / r))).toBeCloseTo(1, 8)
    })
  })
  it('系统预设、极限交替和确定性随机目标的中心误差低于 0.05dB', () => {
    let seed = 489
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (const rate of [22050,32000,44100,48000,96000]) {
      const vectors = [...EQ_PRESETS.map(p => [...p.bands]), Array(10).fill(6), Array(10).fill(12), Array.from({ length: 10 }, (_, i) => i % 2 ? -12 : 12), ...Array.from({ length: 50 }, () => Array.from({ length: 10 }, () => random() * 24 - 12))]
      for (const bands of vectors) {
        const design = designEqualizer(bands, rate)
        expect(design.maxError).toBeLessThan(0.05)
        expect(design.gains.every(v => Number.isFinite(v) && Math.abs(v) <= 24)).toBe(true)
        design.gains.forEach((gain, i) => { if (!isBandAvailable(i, rate)) expect(gain).toBe(0) })
      }
    }
  })
  it('全段 +6dB 时 500Hz 输出匹配目标，不再叠加到 +8.83dB', () => {
    expect(designedResponse(Array(10).fill(6), 48000, new Float32Array([500]))[0]).toBeCloseTo(6, 2)
  })
})
