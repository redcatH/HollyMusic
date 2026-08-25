/**
 * 频谱合成数据生成器（纯函数，不依赖 DOM / Web Audio）。
 *
 * 用途：AudioSpectrum 拿不到 AnalyserNode 时（iOS 禁止接管音频元素、其他内核
 * 接管失败或尚未接管）的视觉兜底。只生成"看起来像音乐"的数据，与音频链路
 * 完全无关，不触碰后台播放。
 *
 * 设计：低频重、高频轻的能量包络 × 多组不同速率/相位的正弦起伏 × 按频段
 * 索引的确定性扰动，形成波浪式流动而非整体同步跳动。帧间平滑由调用方 lerp
 * （等价 AnalyserNode.smoothingTimeConstant），本函数每帧输出目标值。
 */

/** 与 AnalyserNode fftSize=512 的 frequencyBinCount 对齐；柱条渲染只取前 68%。 */
export const SPECTRUM_SYNTH_BINS = 256

/** 确定性伪随机（mulberry32 风格的 hash），避免真随机导致逐帧抖动。 */
function hash01(index: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 0xffffffff
}

/**
 * 就地写入一帧合成频谱目标值。
 * @param target 长度应为 SPECTRUM_SYNTH_BINS；仅写值，不重分配
 * @param now 单调递增时间戳（performance.now()）
 */
export function spectrumSynth(target: Uint8Array, now: number): void {
  // 三组起伏：慢速整体呼吸、中速波浪、快速细颤；速率差异产生流动感。
  const t1 = (now / 1000) * 1.1
  const t2 = (now / 1000) * 2.3
  const t3 = (now / 1000) * 4.7

  for (let i = 0; i < target.length; i++) {
    const bin = i / target.length
    // 能量包络：低频强、高频弱（幂衰减近似常见音乐频谱形状）。
    const envelope = Math.pow(1 - bin, 0.65)
    // 波浪：相位随频段推进，形成横向流动；每段扰动独立。
    const wave =
      0.5 +
      0.28 * Math.sin(t1 + bin * 5.2 + hash01(i) * 6.28) +
      0.16 * Math.sin(t2 - bin * 8.7 + hash01(i + 101) * 6.28) +
      0.06 * Math.sin(t3 + hash01(i + 202) * 6.28)
    // 呼吸：慢速全局脉动，避免长时间波形过于恒定。
    const breathe = 0.82 + 0.18 * Math.sin(t1 * 0.7 + bin * 1.3)

    const value = envelope * wave * breathe
    target[i] = Math.max(0, Math.min(255, Math.round(value * 255)))
  }
}
