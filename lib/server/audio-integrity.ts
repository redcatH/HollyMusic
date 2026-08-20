/**
 * 音频完整性校验（试听片段判定）。
 *
 * 背景：部分音源对无版权/非 VIP 歌曲返回试听片段（如 30s/60s），这些片段
 * 能正常播放，一旦落库会长期占用缓存且换源后无法自愈（缓存 key 不含
 * 音源脚本标识，命中后 0 次上游调用）。
 *
 * 策略：解析音频文件真实时长（music-metadata），与歌曲元数据 interval
 * （期望时长）对比；相差太远判定为试听——仅影响「是否落库」，不中断
 * 交付，用户可正常试听；后台换可用源后重新拉取到完整版才入库。
 */

import { parseFile } from 'music-metadata'
import { logger } from '@/lib/logger'

/** 期望时长低于该值（秒）不校验：短曲与元数据缺失场景直接放行 */
export const MIN_CHECK_INTERVAL_SEC = 120

/** 实际时长低于期望的该比例视为可疑 */
export const TRIAL_DURATION_RATIO = 0.8

/** 时长绝对差低于该值（秒）不判定：容忍平台元数据误差 */
export const TRIAL_ABS_DIFF_SEC = 30

export interface TrialCheckResult {
  /** true 表示判定为试听片段（应跳过落库 / 删除缓存） */
  trial: boolean
  /** 解析出的实际时长（秒）；null 表示未解析或未校验 */
  actualSec: number | null
}

/** 实际时长 vs 期望时长，是否明显不完整（试听片段） */
export function isIncompleteTrial(actualDurationSec: number, intervalSec: number): boolean {
  if (!Number.isFinite(intervalSec) || intervalSec < MIN_CHECK_INTERVAL_SEC) return false
  if (!Number.isFinite(actualDurationSec) || actualDurationSec <= 0) return false
  return (
    actualDurationSec < intervalSec * TRIAL_DURATION_RATIO &&
    intervalSec - actualDurationSec > TRIAL_ABS_DIFF_SEC
  )
}

/** 解析本地音频文件的真实时长（秒）；解析失败返回 null（宁放过不误杀） */
export async function parseDurationFromFile(filePath: string): Promise<number | null> {
  try {
    const meta = await parseFile(filePath)
    const duration = meta.format.duration
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      return duration
    }
    return null
  } catch (e) {
    logger.debug(
      `[AudioIntegrity] 时长解析失败 ${filePath}:`,
      e instanceof Error ? e.message : e
    )
    return null
  }
}

/**
 * 校验音频文件是否为试听片段。
 * intervalSec 无效或过短（<120s）→ 不校验，返回 trial=false。
 */
export async function checkTrialAudio(
  filePath: string,
  intervalSec: number
): Promise<TrialCheckResult> {
  if (!Number.isFinite(intervalSec) || intervalSec < MIN_CHECK_INTERVAL_SEC) {
    return { trial: false, actualSec: null }
  }
  const actualSec = await parseDurationFromFile(filePath)
  if (actualSec === null) return { trial: false, actualSec: null }
  return { trial: isIncompleteTrial(actualSec, intervalSec), actualSec }
}
