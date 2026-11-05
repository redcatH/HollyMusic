/** 前端、服务端与 Service Worker 共用的试听判定；保持无运行时依赖。 */
export const MIN_CHECK_INTERVAL_SEC = 120
export const TRIAL_DURATION_RATIO = 0.8
export const TRIAL_ABS_DIFF_SEC = 30

export function isIncompleteTrial(actualDurationSec: number, intervalSec: number): boolean {
  if (!Number.isFinite(intervalSec) || intervalSec < MIN_CHECK_INTERVAL_SEC) return false
  if (!Number.isFinite(actualDurationSec) || actualDurationSec <= 0) return false
  return actualDurationSec < intervalSec * TRIAL_DURATION_RATIO
    && intervalSec - actualDurationSec > TRIAL_ABS_DIFF_SEC
}

/** 长曲必须有可校验的真实时长；短曲和缺失期望时长沿用服务端放行规则。 */
export function isAudioDurationValid(actualSec: number, expectedSec: number): boolean {
  return !Number.isFinite(expectedSec) || expectedSec < MIN_CHECK_INTERVAL_SEC
    || (Number.isFinite(actualSec) && actualSec > 0 && !isIncompleteTrial(actualSec, expectedSec))
}
