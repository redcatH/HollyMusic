import { AudioParamSmoother } from './audio-param-smoother'
import { designEqualizer, protectionDb, type EqualizerSettings } from './equalizer'

/** 所有自动化都走同一控制器，允许真实 OfflineAudioContext 验证。 */
export function createEqualizerAutomation(
  context: Pick<BaseAudioContext, 'currentTime' | 'sampleRate'>,
  filters: BiquadFilterNode[], preamp: GainNode, protection: GainNode,
  initial: EqualizerSettings,
): { update: (settings: EqualizerSettings) => void } {
  const initialGains = designEqualizer(initial.bands, context.sampleRate).gains
  // 首次连接媒体之前初始化，避免首帧 EQ 提升而保护尚未落位。
  filters.forEach((filter, i) => { filter.gain.value = initial.enabled ? initialGains[i] : 0 })
  preamp.gain.value = Math.pow(10, (initial.enabled ? initial.preamp : 0) / 20)
  protection.gain.value = Math.pow(10, protectionDb(initial, context.sampleRate, initialGains) / 20)
  const filterAutomation = filters.map(filter => new AudioParamSmoother(filter.gain))
  const manualAutomation = new AudioParamSmoother(preamp.gain)
  const protectionAutomation = new AudioParamSmoother(protection.gain)
  let previous = initial

  return { update: settings => {
    // 保存/删除/选择同参数预设只改变元数据，不中断正在运行的自动化。
    const sameAudio = settings.enabled === previous.enabled
      && settings.preamp === previous.preamp && settings.autoPreamp === previous.autoPreamp
      && settings.bands.every((value, i) => value === previous.bands[i])
    if (sameAudio) { previous = settings; return }
    const now = context.currentTime
    const targets = designEqualizer(settings.bands, context.sampleRate).gains.map(v => settings.enabled ? v : 0)
    const current = filterAutomation.map(param => param.hold(now))
    const manual = manualAutomation.hold(now)
    const currentProtection = protectionAutomation.hold(now)
    const guard = (settings.enabled && settings.autoPreamp) || (previous.enabled && previous.autoPreamp) || currentProtection < 0.99999
    // 使用正在运行的参数值，不以“上次目标”冒充尚未走完的时间线。
    const envelope = targets.map((v, i) => Math.max(0, v, current[i]))
    const transient = guard ? protectionDb({ ...settings, enabled: true, autoPreamp: true,
      // 前级以线性增益平滑，整个过渡的上界即当前/目标的较大值；负值也提供有效余量。
      preamp: Math.max(20 * Math.log10(Math.max(1e-12, manual)), settings.enabled ? settings.preamp : 0),
    }, context.sampleRate, envelope) : 0
    if (transient < 0) protectionAutomation.target(Math.pow(10, transient / 20), now, 0.003)
    filterAutomation.forEach((param, i) => param.target(targets[i], now))
    manualAutomation.target(Math.pow(10, (settings.enabled ? settings.preamp : 0) / 20), now)
    // 释放调度在音频时钟上，后台冻结 JS 不影响完成旁路。
    protectionAutomation.target(Math.pow(10, protectionDb(settings, context.sampleRate, targets) / 20), now + (transient < 0 ? 0.18 : 0))
    previous = settings
  } }
}
