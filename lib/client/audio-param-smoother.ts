/** 记录本模块拥有的指数自动化，旧内核也能精确保持重调度时的值。 */
export class AudioParamSmoother {
  private initial: number
  private events: Array<{ time: number; from: number; target: number; tau: number }> = []

  constructor(private readonly param: AudioParam) { this.initial = param.value }

  valueAt(time: number): number {
    let value = this.initial
    for (const event of this.events) {
      if (event.time > time) break
      value = event.target + (event.from - event.target) * Math.exp(-(time - event.time) / event.tau)
    }
    return value
  }

  /** 只持有本模块写入的时间线；清理历史，防止长期拖动累积事件。 */
  hold(time: number): number {
    const value = this.valueAt(time)
    if (typeof this.param.cancelAndHoldAtTime === 'function') this.param.cancelAndHoldAtTime(time)
    else this.param.cancelScheduledValues(time)
    // 显式锚点也保证 fallback 的值连续，不读取可能滞后的 AudioParam.value。
    this.param.setValueAtTime(value, time)
    this.initial = value
    this.events = []
    return value
  }

  target(value: number, time: number, tau = 0.015): void {
    const from = this.valueAt(time)
    this.param.setTargetAtTime(value, time, tau)
    this.events.push({ time, from, target: value, tau })
  }
}
