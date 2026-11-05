import { expect, it } from 'vitest'
import { isAudioDurationValid, isIncompleteTrial } from './audio-integrity'

it.each([
  [30, 240, true], [60, 180, true], [143, 180, true],
  [144, 180, false], [150, 180, false], [180, 180, false],
  [240, 180, false], [10, 90, false], [30, 0, false],
  [0, 180, false], [NaN, 180, false], [Infinity, 180, false],
])('实际 %s 秒、期望 %s 秒，疑似试听=%s', (actual, expected, trial) => {
  expect(isIncompleteTrial(actual, expected)).toBe(trial)
})

it.each([0, NaN, Infinity, -1, 30])('长曲的真实时长 %s 不可作为完整缓存', actual => {
  expect(isAudioDurationValid(actual, 240)).toBe(false)
})

it('短曲、缺失期望时长和元数据的小幅偏差不误删', () => {
  expect(isAudioDurationValid(0, 60)).toBe(true)
  expect(isAudioDurationValid(0, 0)).toBe(true)
  expect(isAudioDurationValid(190, 200)).toBe(true)
})
