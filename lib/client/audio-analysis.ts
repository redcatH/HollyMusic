import { useEqualizerStore } from '@/lib/store/equalizer-store'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { EQ_FREQUENCIES, filterQ, filterFrequency } from './equalizer'
import { createEqualizerAutomation } from './equalizer-automation'
import { EQ_STATUS_MESSAGES, type EqualizerStatus } from './equalizer-status'

/**
 * 频谱分析管线的所有权模块。
 *
 * 不变式（无法提供 Web Audio 分析数据的浏览器——iOS、接管失败的内核——
 * 频谱视觉由 AudioSpectrum 的合成动画兜底，见 lib/client/spectrum-synth.ts）：
 * 媒体元素只允许接入「已确认 running」的 AudioContext。
 *
 * 背景：createMediaElementSource 一旦执行不可撤销。若把元素接进 suspended 的
 * context，Chromium 系内核会冻结媒体时钟——进度停在 0:00、play() Promise
 * 永不 resolve、浏览器停止拉流且不触发任何 error 事件，播放被无声杀死。
 * 因此接管动作只允许发生在真实手势调用链中，且必须等待 context.resume()
 * 确认成功；任一前置失败 → 返回 null，频谱降级为合成动画，下个手势重试。
 */

export interface AudioAnalysisPipeline {
  context: AudioContext
  analyser: AnalyserNode
  source: MediaElementAudioSourceNode
  filters: BiquadFilterNode[]
  preamp: GainNode
  protection: GainNode
  dispose: () => void
}

type AudioContextConstructor = new () => AudioContext

/** Safari 旧版仍以 webkitAudioContext 暴露 Web Audio。 */
function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const legacyWindow = window as Window & { webkitAudioContext?: AudioContextConstructor }
  return window.AudioContext ?? legacyWindow.webkitAudioContext ?? null
}

/**
 * iOS（含 iPadOS 与主屏 PWA）默认禁用频谱接管：元素一旦接入
 * MediaElementAudioSourceNode，音频就只能经 AudioContext 输出，而 iOS 在
 * 退后台/锁屏时会挂起 AudioContext——HTML5 本可后台续播的音频被无声杀死。
 * 接管不可逆，因此默认不接管；只有用户明确启用 EQ 才接入，并在面板提示后台限制。
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  // iPadOS 13+ 的 Safari 伪装成桌面 UA：MacIntel 平台 + 多触点即 iPad。
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** 同一 Audio 元素只能创建一次 MediaElementSource；桌面/移动布局可能同时挂载，按元素复用。 */
const disposed = new WeakSet<HTMLAudioElement>()
const pipelines = new WeakMap<HTMLAudioElement, AudioAnalysisPipeline>()

/** 进行中的接管；多个频谱实例在手势里并发触发时去重，避免创建多个 context。 */
const attaching = new WeakMap<HTMLAudioElement, Promise<AudioAnalysisPipeline | null>>()

/** resume 在 autoplay 被策略阻断时可能永久 pending；超时视为失败，绝不因等待而悬挂接管。 */
const RESUME_TIMEOUT_MS = 1500

function settleWithTimeout(resume: Promise<void>): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), RESUME_TIMEOUT_MS)
    resume.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(false)
      },
    )
  })
}

/** 复用既有管线。非手势路径（原生 play/playing 事件、后挂载）唯一允许的操作：绝不创建。 */
export function getExistingAnalysisPipeline(audio: HTMLAudioElement): AudioAnalysisPipeline | null {
  return pipelines.get(audio) ?? null
}

/**
 * 创建并接管分析管线。调用方必须处于 pointer/touch/click 处理期间——context
 * 的创建与 resume 只有在手势内才可能获批；非手势调用请使用
 * getExistingAnalysisPipeline。
 */
export function attachAnalysisPipeline(audio: HTMLAudioElement): Promise<AudioAnalysisPipeline | null> {
  if (disposed.has(audio) || (isAppleMobile() && !useEqualizerStore.getState().settings.enabled)) return Promise.resolve(null)
  const existing = pipelines.get(audio)
  if (existing) return Promise.resolve(existing)

  const inFlight = attaching.get(audio)
  if (inFlight) return inFlight

  const task = createPipeline(audio).finally(() => {
    attaching.delete(audio)
  })
  attaching.set(audio, task)
  return task
}

async function createPipeline(audio: HTMLAudioElement): Promise<AudioAnalysisPipeline | null> {
  const AudioContextClass = getAudioContextConstructor()
  const report = (status: EqualizerStatus) => {
    if (!disposed.has(audio)) useEqualizerStore.setState({ status })
  }
  if (!AudioContextClass) { report('unsupported'); return null }
  if (isAppleMobile() && !useEqualizerStore.getState().settings.enabled) return null
  if (audio.src) {
    const url = new URL(audio.src, location.href)
    if (url.protocol !== 'blob:' && url.origin !== location.origin) {
      report('unsupported-source')
      return null
    }
  }

  let context: AudioContext | null = null
  try {
    context = new AudioContextClass()
    if (context.state !== 'running') {
      const resumed = await settleWithTimeout(context.resume())
      if (!resumed) {
        if (!disposed.has(audio) && !(isAppleMobile() && !useEqualizerStore.getState().settings.enabled)) {
          report('resume-blocked')
        }
        // 图无法运行：绝不接管元素（接管即冻结播放），释放后由下个手势重试。
        void context.close().catch(() => {})
        return null
      }
    }
    // resume() 对 state 的副作用无法被类型系统感知，重新读取后再做最终确认。
    const stateAfterResume: AudioContextState = context.state
    // resume 可能跨越多次用户操作；iOS 关闭 EQ 后不能再执行不可逆接管。
    if (stateAfterResume !== 'running' || disposed.has(audio)
      || (isAppleMobile() && !useEqualizerStore.getState().settings.enabled)) {
      void context.close().catch(() => {})
      return null
    }

    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.8
    const filters = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = context!.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = filterFrequency(frequency, context!.sampleRate)
      filter.Q.value = filterQ(index, context!.sampleRate)
      return filter
    })
    const preamp = context.createGain()
    const protection = context.createGain()
    // 在不可逆接管之前完成全部可失败的节点创建与连接。
    filters.forEach((filter, i) => filter.connect(filters[i + 1] ?? preamp))
    preamp.connect(protection)
    protection.connect(analyser)
    analyser.connect(context.destination)
    const automation = createEqualizerAutomation(context, filters, preamp, protection, useEqualizerStore.getState().settings)
    const source = context.createMediaElementSource(audio)
    source.connect(filters[0])
    const activeContext = context
    const unsubscribe = useEqualizerStore.subscribe((state, old) => {
      if (state.settings !== old.settings) automation.update(state.settings)
    })
    const onState = () => report(activeContext.state === 'running' ? 'running' : 'interrupted')
    activeContext.addEventListener('statechange', onState)
    const pipeline: AudioAnalysisPipeline = { context, analyser, source, filters, preamp, protection, dispose: () => {
      unsubscribe()
      activeContext.removeEventListener('statechange', onState)
      ;[source, ...filters, preamp, protection, analyser].forEach(node => node.disconnect())
      void activeContext.close().catch(() => {})
    } }
    pipelines.set(audio, pipeline)
    useEqualizerStore.setState({ sampleRate: context.sampleRate, status: 'running' })
    return pipeline
  } catch (error) {
    logger.warn('[AudioAnalysis] 初始化音频链路失败', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    report('initialization-failed')
    // 某些 Android 浏览器会拒绝在非用户手势中创建 MediaElementSource；下个手势再重试。
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    return null
  }
}

/** 播放器拥有资源，频谱组件的卸载不销毁共享链路。 */
export function disposeAnalysisPipeline(audio: HTMLAudioElement): void {
  disposed.add(audio)
  pipelines.get(audio)?.dispose()
  pipelines.delete(audio)
}

export async function resumeAudioPipeline(audio: HTMLAudioElement): Promise<void> {
  const pipeline = getExistingAnalysisPipeline(audio)
  if (!pipeline) return
  if (pipeline.context.state !== 'running') await settleWithTimeout(pipeline.context.resume())
  // 等待期间播放器可能已卸载；旧链路的结果不能覆盖新播放器的状态。
  if (disposed.has(audio) || getExistingAnalysisPipeline(audio) !== pipeline) return
  useEqualizerStore.setState({ status: pipeline.context.state === 'running' ? 'running' : 'interrupted' })
}

/** 标签页与 standalone 共用；恢复 context 不调用 play/load/seek。 */
export function bindEqualizerLifecycle(audio: HTMLAudioElement): () => void {
  const stopStatus = useEqualizerStore.subscribe((state, old) => {
    const message = EQ_STATUS_MESSAGES[state.status]
    if (state.settings.enabled && message && state.status !== old.status) toast.warning(message, 6000)
  })
  const gesture = () => {
    if (useEqualizerStore.getState().settings.enabled) void attachAnalysisPipeline(audio).then(() => resumeAudioPipeline(audio))
    else void resumeAudioPipeline(audio)
  }
  const visible = () => { if (!document.hidden && !audio.paused) void resumeAudioPipeline(audio) }
  const play = () => { void resumeAudioPipeline(audio) }
  // click 冒泡到 window 时 React 已提交复选框的新值。捕获阶段报告音频状态
  // 会先触发外部 store 重渲染，还原浏览器刚切换的 checked，导致开关无法切换。
  window.addEventListener('click', gesture)
  window.addEventListener('touchend', gesture, true)
  window.addEventListener('keydown', gesture, true)
  window.addEventListener('pageshow', visible)
  document.addEventListener('visibilitychange', visible)
  audio.addEventListener('play', play)
  // 不订阅媒体 error/playing：它们不能证明 Web Audio 链路失败或恢复。
  return () => {
    stopStatus()
    window.removeEventListener('click', gesture)
    window.removeEventListener('touchend', gesture, true)
    window.removeEventListener('keydown', gesture, true)
    window.removeEventListener('pageshow', visible)
    document.removeEventListener('visibilitychange', visible)
    audio.removeEventListener('play', play)
    disposeAnalysisPipeline(audio)
  }
}
