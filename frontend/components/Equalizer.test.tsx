import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultEqualizer, designEqualizer, EQ_PRESETS } from '@/lib/client/equalizer'
import { EQ_STORAGE_KEY, readEqualizer, useEqualizerStore } from '@/lib/store/equalizer-store'
import { attachAnalysisPipeline, bindEqualizerLifecycle, disposeAnalysisPipeline, getExistingAnalysisPipeline, resumeAudioPipeline } from '@/lib/client/audio-analysis'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ toast: { warning: vi.fn() } }))

class Param {
  value = 0
  cancelScheduledValues = vi.fn()
  setValueAtTime = vi.fn()
  cancelAndHoldAtTime = vi.fn()
  setTargetAtTime = vi.fn()
}
class Node {
  gain = new Param()
  frequency = new Param()
  Q = new Param()
  type = ''
  connect = vi.fn()
  disconnect = vi.fn()
}
class Context extends EventTarget {
  static instances: Context[] = []
  state: string = 'running'
  sampleRate = 48000
  currentTime = 0
  destination = new Node()
  source = new Node()
  filters: Node[] = []
  gains: Node[] = []
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createAnalyser = vi.fn(() => new Node())
  createMediaElementSource = vi.fn(() => this.source)
  createBiquadFilter = () => { const node = new Node(); this.filters.push(node); return node }
  createGain = () => { const node = new Node(); this.gains.push(node); return node }
  constructor() { super(); Context.instances.push(this) }
}
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  Context.instances = []
  vi.stubGlobal('AudioContext', Context)
  useEqualizerStore.setState({ settings: defaultEqualizer(), saved: [], status: 'idle' })
  vi.mocked(toast.warning).mockClear()
})
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('EQ 持久化与预设', () => {
  it('预设、手动切换、自定义保存恢复删除、重置保留用户预设', () => {
    const store = () => useEqualizerStore.getState()
    store().selectPreset('rock')
    expect(store().settings.bands).toEqual(EQ_PRESETS.find(p => p.id === 'rock')!.bands)
    store().setBand(2, 7)
    expect(store().settings.preset).toBe('custom')
    store().update({ preamp: -3, enabled: true })
    store().save('我的声音')
    const id = store().settings.preset
    store().reset()
    expect(store().settings.bands).toEqual(Array(10).fill(0))
    expect(store().saved).toHaveLength(1)
    store().selectPreset(id)
    expect(store().settings.bands[2]).toBe(7)
    expect(store().settings.preamp).toBe(-3)
    window.dispatchEvent(new Event('pagehide'))
    expect(readEqualizer().settings).toEqual(store().settings)
    expect(localStorage.getItem(EQ_STORAGE_KEY)).toContain('我的声音')
    store().remove(id)
    expect(store().saved).toHaveLength(0)
    expect(store().settings.preset).toBe('custom')
  })
  it('存储异常不阻止当前会话调节', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    useEqualizerStore.getState().setBand(0, 4)
    expect(() => vi.advanceTimersByTime(200)).not.toThrow()
    expect(useEqualizerStore.getState().settings.bands[0]).toBe(4)
  })
})
describe('共享音频链路', () => {
  it('并发接管与切换参数只创建一个 source/context，连接单一路径', async () => {
    const audio = new Audio()
    const [pipeline, same] = await Promise.all([attachAnalysisPipeline(audio), attachAnalysisPipeline(audio)])
    expect(pipeline).toBe(same)
    expect(Context.instances).toHaveLength(1)
    const context = Context.instances[0]
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1)
    expect(context.source.connect).toHaveBeenCalledTimes(1)
    expect(context.filters).toHaveLength(10)
    expect(context.filters[9].connect).toHaveBeenCalledWith(context.gains[0])
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.gains[1])
    useEqualizerStore.getState().update({ enabled: true })
    useEqualizerStore.getState().setBand(3, 5)
    expect(context.filters[3].gain.setTargetAtTime).toHaveBeenLastCalledWith(designEqualizer(useEqualizerStore.getState().settings.bands, 48000).gains[3], 0, 0.015)
    useEqualizerStore.getState().update({ enabled: false })
    expect(context.filters[3].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.015)
    expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.015)
    expect(context.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.015)
    audio.src = '/api/audio?uid=second'
    expect(await attachAnalysisPipeline(audio)).toBe(pipeline)
    disposeAnalysisPipeline(audio)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(context.source.disconnect).toHaveBeenCalledTimes(1)
    expect(getExistingAnalysisPipeline(audio)).toBeNull()
    expect(await attachAnalysisPipeline(audio)).toBeNull()
    const calls = context.filters[3].gain.setTargetAtTime.mock.calls.length
    useEqualizerStore.getState().setBand(3, 6)
    expect(context.filters[3].gain.setTargetAtTime).toHaveBeenCalledTimes(calls)
  })
  it('启动即应用保存的保护；快速反向调整按当前值保持余量', async () => {
    const bands = Array(10).fill(0); bands[5] = 12
    useEqualizerStore.getState().update({ enabled: true, bands })
    const audio = new Audio()
    await attachAnalysisPipeline(audio)
    const context = Context.instances[0]
    expect(context.filters[5].gain.value).toBe(designEqualizer(bands, 48000).gains[5])
    expect(context.gains[1].gain.value).toBeLessThan(0.3)
    context.currentTime = 1
    useEqualizerStore.getState().setBand(5, -12)
    context.currentTime = 1.001
    useEqualizerStore.getState().setBand(5, 0)
    const calls = context.gains[1].gain.setTargetAtTime.mock.calls
    expect(calls.at(-2)![0]).toBeLessThan(0.5)
    expect(calls.at(-1)![1]).toBeCloseTo(1.181)
    expect(context.filters[5].gain.setValueAtTime.mock.calls.at(-1)![0]).toBeGreaterThan(5)
    disposeAnalysisPipeline(audio)
  })
  it('负前级保存或修改预设标识不会重调度音频', async () => {
    const store = () => useEqualizerStore.getState()
    store().selectPreset('rock')
    store().update({ enabled: true, preamp: -12 })
    const audio = new Audio()
    await attachAnalysisPipeline(audio)
    const context = Context.instances[0]
    expect(context.gains[1].gain.value).toBe(1)
    context.currentTime = 1
    store().save('负前级摇滚')
    store().update({ preset: 'custom', bands: [...store().settings.bands] })
    for (const node of [...context.filters, ...context.gains]) {
      expect(node.gain.setValueAtTime).not.toHaveBeenCalled()
      expect(node.gain.setTargetAtTime).not.toHaveBeenCalled()
    }
    disposeAnalysisPipeline(audio)
  })
  it('负前级实际调节时计入已有衰减，不产生多余的瞬态保护', async () => {
    const store = () => useEqualizerStore.getState()
    store().selectPreset('rock')
    store().update({ enabled: true, preamp: -12 })
    const audio = new Audio()
    await attachAnalysisPipeline(audio)
    const context = Context.instances[0]
    context.currentTime = 1
    store().setBand(0, 4.5)
    expect(context.gains[1].gain.setTargetAtTime).toHaveBeenCalledExactlyOnceWith(1, 1, 0.015)
    context.gains[1].gain.setTargetAtTime.mockClear()
    context.currentTime = 2
    store().update({ preamp: -10 })
    expect(context.gains[1].gain.setTargetAtTime).toHaveBeenCalledExactlyOnceWith(1, 2, 0.015)
    disposeAnalysisPipeline(audio)
  })
  it('iOS 等待 resume 期间关闭 EQ 不会接管，之后仍可重新启用', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone')
    let finishResume!: () => void
    vi.stubGlobal('AudioContext', class extends Context {
      state = 'suspended'
      resume = vi.fn(() => new Promise<void>(resolve => { finishResume = () => { this.state = 'running'; resolve() } }))
    })
    useEqualizerStore.getState().update({ enabled: true })
    const audio = new Audio()
    const task = attachAnalysisPipeline(audio)
    useEqualizerStore.getState().update({ enabled: false })
    finishResume()
    expect(await task).toBeNull()
    expect(Context.instances[0].createMediaElementSource).not.toHaveBeenCalled()
    expect(Context.instances[0].close).toHaveBeenCalledTimes(1)
    expect(getExistingAnalysisPipeline(audio)).toBeNull()
    vi.stubGlobal('AudioContext', Context)
    useEqualizerStore.getState().update({ enabled: true })
    expect(await attachAnalysisPipeline(audio)).not.toBeNull()
    disposeAnalysisPipeline(audio)
  })
  it('恢复中断只恢复 context，不调用媒体 play/load 或改变进度', async () => {
    const audio = new Audio()
    const cleanup = bindEqualizerLifecycle(audio)
    await attachAnalysisPipeline(audio)
    const play = vi.spyOn(audio, 'play')
    const load = vi.spyOn(audio, 'load')
    Context.instances[0].state = 'interrupted'
    await resumeAudioPipeline(audio)
    expect(Context.instances[0].resume).toHaveBeenCalledTimes(1)
    expect(play).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    cleanup()
    expect(Context.instances[0].close).toHaveBeenCalled()
  })
  it('未接管时主动终止加载不触发 EQ 警告', () => {
    useEqualizerStore.getState().update({ enabled: true })
    const audio = new Audio()
    const cleanup = bindEqualizerLifecycle(audio)
    try {
      Object.defineProperty(audio, 'error', { value: { code: 1, message: 'MEDIA_ERR_ABORTED' } })
      audio.dispatchEvent(new Event('error'))
      expect(useEqualizerStore.getState().status).toBe('idle')
      expect(toast.warning).not.toHaveBeenCalled()
      expect(Context.instances).toHaveLength(0)
    } finally { cleanup() }
  })
  it.each([1, 2, 3, 4])('媒体错误 %i 及同源音质重试不改变运行中的 EQ', async code => {
    useEqualizerStore.getState().update({ enabled: true })
    const audio = new Audio('/api/audio?uid=kw-song&quality=flac')
    const cleanup = bindEqualizerLifecycle(audio)
    try {
      const pipeline = await attachAnalysisPipeline(audio)
      Object.defineProperty(audio, 'error', { configurable: true, value: { code } })
      audio.dispatchEvent(new Event('error'))
      expect(useEqualizerStore.getState().status).toBe('running')
      audio.src = '/api/audio?uid=kw-song&quality=128k'
      Object.defineProperty(audio, 'error', { configurable: true, value: null })
      for (const event of ['loadedmetadata', 'canplay', 'play', 'playing']) audio.dispatchEvent(new Event(event))
      await Promise.resolve()
      expect(useEqualizerStore.getState().status).toBe('running')
      expect(toast.warning).not.toHaveBeenCalled()
      expect(getExistingAnalysisPipeline(audio)).toBe(pipeline)
      expect(Context.instances).toHaveLength(1)
    } finally { cleanup() }
  })
  it('媒体成功或失败都不掩盖 context 中断，context 恢复才清除警告', async () => {
    useEqualizerStore.getState().update({ enabled: true })
    const audio = new Audio()
    const cleanup = bindEqualizerLifecycle(audio)
    try {
      await attachAnalysisPipeline(audio)
      const context = Context.instances[0]
      context.state = 'suspended'
      context.dispatchEvent(new Event('statechange'))
      context.resume.mockRejectedValue(new Error('resume blocked'))
      for (const event of ['error', 'loadedmetadata', 'canplay', 'play', 'playing']) audio.dispatchEvent(new Event(event))
      await resumeAudioPipeline(audio)
      expect(useEqualizerStore.getState().status).toBe('interrupted')
      expect(toast.warning).toHaveBeenCalledTimes(1)
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('系统暂停'), 6000)
      context.state = 'running'
      context.dispatchEvent(new Event('statechange'))
      expect(useEqualizerStore.getState().status).toBe('running')
    } finally { cleanup() }
  })
  it('resume 成功但未派发 statechange 时也会恢复 EQ 状态', async () => {
    const audio = new Audio()
    await attachAnalysisPipeline(audio)
    try {
      const context = Context.instances[0]
      context.state = 'suspended'
      context.dispatchEvent(new Event('statechange'))
      expect(useEqualizerStore.getState().status).toBe('interrupted')
      await resumeAudioPipeline(audio)
      expect(useEqualizerStore.getState().status).toBe('running')
    } finally { disposeAnalysisPipeline(audio) }
  })
  it('已销毁链路的异步恢复结果不会覆盖新播放器状态', async () => {
    const oldAudio = new Audio()
    await attachAnalysisPipeline(oldAudio)
    const context = Context.instances[0]
    context.state = 'suspended'
    let finishResume!: () => void
    context.resume.mockImplementation(() => new Promise<void>(resolve => { finishResume = resolve }))
    const pending = resumeAudioPipeline(oldAudio)
    disposeAnalysisPipeline(oldAudio)
    const newAudio = new Audio()
    try {
      await attachAnalysisPipeline(newAudio)
      finishResume()
      await pending
      expect(useEqualizerStore.getState().status).toBe('running')
    } finally { disposeAnalysisPipeline(newAudio) }
  })
  it('未获准运行时不接管；超时后仍可重试', async () => {
    vi.stubGlobal('AudioContext', class extends Context { state = 'suspended'; resume = vi.fn(() => new Promise<void>(() => {})) })
    const audio = new Audio()
    const task = attachAnalysisPipeline(audio)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await task).toBeNull()
    expect(Context.instances[0].createMediaElementSource).not.toHaveBeenCalled()
    vi.stubGlobal('AudioContext', Context)
    expect(await attachAnalysisPipeline(audio)).not.toBeNull()
    disposeAnalysisPipeline(audio)
  })
  it('跨域源拒绝接管并明确提示，原生媒体不受修改', async () => {
    const audio = new Audio('https://music.example/test.mp3')
    expect(await attachAnalysisPipeline(audio)).toBeNull()
    expect(Context.instances).toHaveLength(0)
    expect(useEqualizerStore.getState().status).toBe('unsupported-source')
  })
  it('iOS 默认不接管，明确启用 EQ 后可接入', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone')
    const audio = new Audio()
    expect(await attachAnalysisPipeline(audio)).toBeNull()
    useEqualizerStore.getState().update({ enabled: true })
    expect(await attachAnalysisPipeline(audio)).not.toBeNull()
    disposeAnalysisPipeline(audio)
  })
})
