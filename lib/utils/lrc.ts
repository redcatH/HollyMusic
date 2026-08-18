/**
 * 客户端 LRC 歌词解析（时间单位：秒）
 */

export interface LrcLine {
  time: number // 秒
  text: string
}

const LRC_TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LRC_OFFSET_TAG = /\[offset:\s*(-?\d+)\]/i

/**
 * 解析 LRC 文本为按时间升序的行数组。
 * - 支持一行多时间标签
 * - 解析全局 [offset:] 偏移（毫秒，正数提前）
 * - 忽略 [ti:]/[ar:]/[al:]/[by:] 等 ID 标签
 */
export function parseLrc(lrcText: string | null | undefined): LrcLine[] {
  if (!lrcText) return []

  const offsetMatch = LRC_OFFSET_TAG.exec(lrcText)
  const offsetMs = offsetMatch ? parseInt(offsetMatch[1], 10) || 0 : 0

  const tagStrip = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g
  const lines: LrcLine[] = []

  for (const raw of lrcText.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue

    LRC_TIME_TAG.lastIndex = 0
    const times: number[] = []
    let m: RegExpExecArray | null
    while ((m = LRC_TIME_TAG.exec(line)) !== null) {
      const min = parseInt(m[1], 10) || 0
      const sec = parseInt(m[2], 10) || 0
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) || 0 : 0
      times.push(min * 60 + sec + frac / 1000)
    }
    if (times.length === 0) continue

    const text = line.replace(tagStrip, '').trim()
    if (!text) continue
    for (const t of times) lines.push({ time: Math.max(0, t + offsetMs / 1000), text })
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

/**
 * 纯文本歌词回退：tx/kw/mg 等音源常返回无时间轴文本（[!text] 前缀整体纯文本），
 * parseLrc 会全部丢弃导致「暂无歌词」。这里按行展示，time 置 NaN——
 * findActiveLineIndex 的比较对 NaN 恒为 false，永不高亮/滚动跟随。
 */
export function parsePlainText(lrcText: string | null | undefined): LrcLine[] {
  if (!lrcText) return []
  const lines: LrcLine[] = []
  for (const raw of lrcText.split(/\r\n|\r|\n/)) {
    const line = raw.trim().replace(/^\[!text\]/i, '').trim()
    if (line) lines.push({ time: Number.NaN, text: line })
  }
  return lines
}

/**
 * 二分查找当前时间对应的歌词行索引（time <= currentTime 的最后一行）。
 */
export function findActiveLineIndex(lines: LrcLine[], currentTime: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= currentTime) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}
