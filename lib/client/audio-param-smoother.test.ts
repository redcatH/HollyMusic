import { describe, expect, it, vi } from 'vitest'
import { AudioParamSmoother } from './audio-param-smoother'

describe.each([true, false])('连续自动化（原生 hold=%s）', native => {
  it('重调度保持正在进行的指数曲线值，清除未来事件', () => {
    const param = { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), ...(native ? { cancelAndHoldAtTime: vi.fn() } : {}) }
    const smoother = new AudioParamSmoother(param as unknown as AudioParam)
    smoother.target(0.25, 0, 0.015)
    smoother.target(1, 0.18)
    const current = 0.25 + 0.75 * Math.exp(-0.01 / 0.015)
    expect(smoother.hold(0.01)).toBeCloseTo(current, 10)
    expect(param.setValueAtTime).toHaveBeenCalledWith(current, 0.01)
    if (native) expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(0.01)
    else expect(param.cancelScheduledValues).toHaveBeenCalledWith(0.01)
    smoother.target(0.5, 0.01)
    expect(smoother.valueAt(0.01)).toBeCloseTo(current, 10)
    expect(smoother.valueAt(0.19)).toBeCloseTo(0.5, 4)
  })
})
