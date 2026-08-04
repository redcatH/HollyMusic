/**
 * 浏览器原生音频解码能力探测（能力上限 codecCap）。
 *
 * 目的：避免对已知解不了的高音质格式（典型：手机 WebView 解不了 FLAC）反复试错请求。
 * - 启动时 canPlayType 探测一次 → 得到能力上限
 * - resolveQuality 结果再用 codecCap 压一遍 → 不请求已知不支持的格式
 *
 * 仅内存、不持久化：浏览器更新后下次启动 canPlayType 重新探测即可恢复最高支持。
 * 不再做"实测失败下调"：errCode 3/4 多是单首音源问题，误判为能力不足会污染整会话音质。
 */
import type { QualityType } from './types/music'
import { QUALITY_ORDER } from './quality-options'

/**
 * 探测浏览器原生 <audio> 对 FLAC 的解码能力，返回「可播放的最高音质档」。
 *
 * canPlayType 同步、无网络、纯靠浏览器内置编解码器信息：
 * - 返回 ''（空串）= 明确不支持 → 上限压到 MP3 最高档(320k)
 * - 返回 'maybe'/'probably' = 可能支持 → 不限制(flac24bit)，靠实测校准兜底
 *
 * canPlayType 无法区分 16bit/24bit FLAC，故 flac24bit 一律先放行，实测失败再校准。
 * SSR（无 window/document）默认不限制。
 */
export function detectCodecCap(): QualityType {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'flac24bit'
  }
  try {
    const a = document.createElement('audio')
    const supported = (type: string) => {
      const r = a.canPlayType(type)
      return r === 'probably' || r === 'maybe'
    }
    const flacOK = supported('audio/flac') || supported('audio/x-flac')
    return flacOK ? 'flac24bit' : '320k'
  } catch {
    return 'flac24bit' // 探测异常保守放行，交实测兜底
  }
}

/**
 * 把音质压到浏览器能力上限以内：取 q 和 cap 中较低的那档。
 * QUALITY_ORDER 高→低（index 0 最高），取 max(index) 即较低档。
 */
export function capQuality(q: QualityType, cap: QualityType): QualityType {
  const qi = QUALITY_ORDER.indexOf(q)
  const ci = QUALITY_ORDER.indexOf(cap)
  return QUALITY_ORDER[Math.max(qi, ci)]
}
