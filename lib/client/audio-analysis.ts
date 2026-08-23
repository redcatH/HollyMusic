/**
 * 频谱分析管线的所有权模块。
 *
 * 不变式（README 契约：无法提供 Web Audio 分析数据的浏览器频谱自动为空）：
 * 媒体元素只允许接入「已确认 running」的 AudioContext。
 *
 * 背景：createMediaElementSource 一旦执行不可撤销。若把元素接进 suspended 的
 * context，Chromium 系内核会冻结媒体时钟——进度停在 0:00、play() Promise
 * 永不 resolve、浏览器停止拉流且不触发任何 error 事件，播放被无声杀死。
 * 因此接管动作只允许发生在真实手势调用链中，且必须等待 context.resume()
 * 确认成功；任一前置失败 → 返回 null，频谱降级为空，下个手势重试。
 */

export interface AudioAnalysisPipeline {
  context: AudioContext
  analyser: AnalyserNode
}

type AudioContextConstructor = new () => AudioContext

/** Safari 旧版仍以 webkitAudioContext 暴露 Web Audio。 */
function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const legacyWindow = window as Window & { webkitAudioContext?: AudioContextConstructor }
  return window.AudioContext ?? legacyWindow.webkitAudioContext ?? null
}

/** 同一 Audio 元素只能创建一次 MediaElementSource；桌面/移动布局可能同时挂载，按元素复用。 */
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
  if (!AudioContextClass) return null

  let context: AudioContext | null = null
  try {
    context = new AudioContextClass()
    if (context.state !== 'running') {
      const resumed = await settleWithTimeout(context.resume())
      if (!resumed) {
        // 图无法运行：绝不接管元素（接管即冻结播放），释放后由下个手势重试。
        void context.close().catch(() => {})
        return null
      }
    }
    // resume() 对 state 的副作用无法被类型系统感知，重新读取后再做最终确认。
    const stateAfterResume: AudioContextState = context.state
    if (stateAfterResume !== 'running') {
      void context.close().catch(() => {})
      return null
    }

    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.8
    const source = context.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(context.destination)

    const pipeline: AudioAnalysisPipeline = { context, analyser }
    pipelines.set(audio, pipeline)
    return pipeline
  } catch {
    // 某些 Android 浏览器会拒绝在非用户手势中创建 MediaElementSource；下个手势再重试。
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    return null
  }
}
