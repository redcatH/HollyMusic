import { act, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerBar } from '@/components/player/PlayerBar'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'
import { useAuthStore } from '@/hooks/useAuth'
import * as offlineAudio from '@/lib/offline-audio'
import * as playbackResponse from '@/lib/playback-response'
import { attachAnalysisPipeline, getExistingAnalysisPipeline } from '@/lib/client/audio-analysis'
import { defaultEqualizer } from '@/lib/client/equalizer'
import { useEqualizerStore } from '@/lib/store/equalizer-store'
import { EqualizerPanel } from '@/components/player/EqualizerPanel'

// 保留真实的 PC/手机按钮、进度条、store 和音频 hook，只隔离附属服务与音频硬件。
vi.mock('@/hooks/useMediaSession', () => ({ useMediaSession: () => {} }))
vi.mock('@/hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }))
vi.mock('@/components/player/NowPlaying', () => ({ NowPlaying: () => null }))
vi.mock('@/components/player/PlayerTools', () => ({ PlayerTools: () => null }))
vi.mock('@/components/player/AudioSpectrum', () => ({ AudioSpectrum: () => null }))

class TestAudio extends EventTarget {
  src = ''
  crossOrigin = ''
  preload = ''
  volume = 1
  muted = false
  playbackRate = 1
  defaultPlaybackRate = 1
  paused = true
  ended = false
  readyState = 0
  duration = NaN
  currentTime = 0
  error: { code: number } | null = null
  load = vi.fn(() => { this.currentTime = 0; this.readyState = 0; this.duration = NaN })
  play = vi.fn(async () => { this.paused = false; this.ended = false })
  pause = vi.fn(() => { this.paused = true })
  removeAttribute = vi.fn(() => { this.src = '' })
}

const makeTrack = (id: string, interval = '03:10') => toTrack({ uid: `kw-${id}`, musicInfo: {
  name: id, singer: 'tester', source: 'kw', songmid: id, interval,
  types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {},
} })
const track = makeTrack('first')
const second = makeTrack('second')
let root: Root
let container: HTMLDivElement
let audio: TestAudio
let hidden = true

async function ready(duration = 180) {
  await act(async () => {
    audio.readyState = 4
    audio.duration = duration
    audio.dispatchEvent(new Event('loadedmetadata'))
    audio.dispatchEvent(new Event('canplay'))
    audio.dispatchEvent(new Event('playing'))
  })
}

function endAudio() {
  audio.currentTime = 180
  audio.paused = true
  audio.ended = true
  audio.dispatchEvent(new Event('timeupdate'))
  audio.dispatchEvent(new Event('pause'))
  audio.dispatchEvent(new Event('ended'))
}

async function click(button: Element | null) {
  expect(button).not.toBeNull()
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) } })
  vi.stubGlobal('Audio', TestAudio)
  // 不执行 rAF：同时验证后台冻结动画时播放命令仍然有效。
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  hidden = true
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  useEqualizerStore.setState({ settings: defaultEqualizer(), saved: [], status: 'idle' })
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<PlayerBar audio={null} onAudioElement={a => { if (a) audio = a as unknown as TestAudio }} />)
    window.dispatchEvent(new Event('click'))
  })
  // 首次交互在选歌前完成 autoplay 解锁。
  window.dispatchEvent(new Event('click'))
  await act(async () => { await usePlayerStore.getState().playTrack(track, [track]) })
  await ready()
})

describe('iOS 关闭 EQ 恢复原生播放器', () => {
  const param = () => ({ value: 0, cancelAndHoldAtTime() {}, setValueAtTime() {}, setTargetAtTime() {} })
  const node = () => ({ gain: param(), frequency: param(), Q: param(), connect() {}, disconnect: vi.fn() })
  class Context extends EventTarget {
    state = 'running'
    currentTime = 0
    sampleRate = 48000
    destination = node()
    createAnalyser = node
    createGain = node
    createBiquadFilter = node
    createMediaElementSource = vi.fn(node)
    resume = vi.fn(async () => { this.state = 'running' })
    close = vi.fn(async () => { this.state = 'closed' })
  }

  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone')
    vi.stubGlobal('AudioContext', Context)
    vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
  })

  async function enableEq() {
    await act(async () => {
      useEqualizerStore.getState().update({ enabled: true })
      await attachAnalysisPipeline(audio as unknown as HTMLAudioElement)
    })
    const pipeline = getExistingAnalysisPipeline(audio as unknown as HTMLAudioElement)
    expect(pipeline).not.toBeNull()
    return pipeline!
  }

  it.each(['online', 'offline'])('%s 歌曲关闭 EQ 同步恢复原生通道，保留位置与输出设置', async mode => {
    if (mode === 'offline') {
      await act(async () => { usePlayerStore.setState({ streamUrl: 'blob:offline-track' }) })
      await ready()
    }
    await act(async () => {
      usePlayerStore.getState().seek(63)
      usePlayerStore.setState({ volume: 0.45, isMuted: true })
      useEqualizerStore.getState().selectPreset('rock')
    })
    audio.playbackRate = 1.25
    const pipeline = await enableEq()
    const original = audio
    const src = original.src
    const queue = usePlayerStore.getState().queue
    const settings = useEqualizerStore.getState().settings
    await act(async () => {
      useEqualizerStore.getState().update({ enabled: false })
      // 必须在关闭开关的同步手势内调用 play，不能依赖随后执行的 React effect。
      expect(audio).not.toBe(original)
      expect(audio.play).toHaveBeenCalledOnce()
    })
    expect(original.paused).toBe(true)
    expect(original.src).toBe('')
    expect(pipeline.context.close).toHaveBeenCalledOnce()
    expect(getExistingAnalysisPipeline(original as unknown as HTMLAudioElement)).toBeNull()
    expect(getExistingAnalysisPipeline(audio as unknown as HTMLAudioElement)).toBeNull()
    expect(audio).toMatchObject({ src, volume: 0.45, muted: true, playbackRate: 1.25, paused: false })
    // 新元素的初始 0:00 不应覆盖等待恢复的位置。
    await act(async () => audio.dispatchEvent(new Event('timeupdate')))
    expect(usePlayerStore.getState().currentTime).toBe(63)
    await ready()
    expect(audio.currentTime).toBe(63)
    expect(audio.load).toHaveBeenCalledOnce()
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, isPlaying: true, currentTime: 63 })
    expect(usePlayerStore.getState().queue).toBe(queue)
    expect(useEqualizerStore.getState().settings).toEqual({ ...settings, enabled: false })
    expect(useEqualizerStore.getState().status).toBe('idle')
    await act(async () => {
      original.currentTime = 0
      original.error = { code: 3 }
      for (const event of ['timeupdate', 'pause', 'ended', 'error']) original.dispatchEvent(new Event(event))
    })
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, currentTime: 63, isPlaying: true })
  })

  it('暂停时关闭 EQ 保持暂停，随后可正常播放、拖动和切歌', async () => {
    await enableEq()
    await act(async () => {
      usePlayerStore.getState().seek(75)
      usePlayerStore.getState().setIsPlaying(false)
    })
    await act(async () => useEqualizerStore.getState().update({ enabled: false }))
    await ready()
    expect(audio.currentTime).toBe(75)
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.paused).toBe(true)
    await click(container.querySelector('button[aria-label="播放"]'))
    await act(async () => usePlayerStore.getState().seek(90))
    expect(audio).toMatchObject({ paused: false, currentTime: 90 })
    await act(async () => usePlayerStore.getState().playTrack(second, [track, second]))
    await ready()
    expect(audio.src).toContain('kw-second')
    expect(audio).toMatchObject({ paused: false, currentTime: 0 })
  })

  it('加载元数据前关闭 EQ 保留待恢复位置，并尊重随后暂停与拖动', async () => {
    await enableEq()
    await act(async () => {
      usePlayerStore.getState().seek(92)
      usePlayerStore.getState().setQuality('128k')
    })
    expect(audio.readyState).toBe(0)
    await act(async () => useEqualizerStore.getState().update({ enabled: false }))
    expect(audio.src).toContain('quality=128k')
    await act(async () => {
      usePlayerStore.getState().seek(110)
      usePlayerStore.getState().setIsPlaying(false)
    })
    await ready()
    expect(audio).toMatchObject({ currentTime: 110, paused: true })
    expect(usePlayerStore.getState()).toMatchObject({ currentTime: 110, isPlaying: false })
  })

  it('切音质淡出期间关闭 EQ，待执行的加载使用新元素和新音源', async () => {
    await enableEq()
    await act(async () => usePlayerStore.getState().seek(48))
    hidden = false
    const original = audio
    await act(async () => usePlayerStore.getState().setQuality('128k'))
    expect(original.src).not.toContain('quality=128k')
    await act(async () => useEqualizerStore.getState().update({ enabled: false }))
    expect(audio).not.toBe(original)
    expect(audio.src).toContain('quality=128k')
    expect(original.src).toBe('')
    await ready()
    expect(audio.currentTime).toBe(48)
    await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(audio.volume).toBe(0.8)
  })

  it.each(['resolve', 'reject'])('旧 play Promise %s 不会影响替换后已暂停的播放器', async result => {
    await enableEq()
    await act(async () => usePlayerStore.getState().setIsPlaying(false))
    const original = audio
    let finish!: () => void
    original.play.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = () => result === 'resolve' ? resolve() : reject(new Error('old playback failed'))
    }))
    await act(async () => usePlayerStore.getState().setIsPlaying(true))
    await act(async () => useEqualizerStore.getState().update({ enabled: false }))
    await ready()
    await act(async () => usePlayerStore.getState().setIsPlaying(false))
    const volume = audio.volume
    await act(async () => finish())
    expect(audio).toMatchObject({ paused: true, volume })
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, currentTrack: track, urlFetchError: null })
  })

  it('替换后等待 play 完成时点击暂停，不会被迟到的播放结果重新拉起', async () => {
    await enableEq()
    let finish!: () => void
    class DeferredAudio extends TestAudio {
      play = vi.fn(() => new Promise<void>(resolve => {
        finish = () => { this.paused = false; resolve() }
      }))
    }
    vi.stubGlobal('Audio', DeferredAudio)
    await act(async () => useEqualizerStore.getState().update({ enabled: false }))
    await act(async () => usePlayerStore.getState().setIsPlaying(false))
    await act(async () => finish())
    await ready()
    expect(audio.paused).toBe(true)
    expect(usePlayerStore.getState().isPlaying).toBe(false)
  })

  it('关闭 EQ 后立刻切歌，新歌不会继承旧曲待恢复的进度', async () => {
    await enableEq()
    await act(async () => usePlayerStore.getState().seek(92))
    await act(async () => {
      useEqualizerStore.getState().update({ enabled: false })
      await usePlayerStore.getState().playTrack(second, [track, second])
    })
    await ready()
    expect(audio.src).toContain('kw-second')
    expect(audio.currentTime).toBe(0)
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: second, currentTime: 0, isPlaying: true })
  })

  it('通过真实声音设置开关替换元素后，面板接收新元素并可再次启用 EQ', async () => {
    function PlayerWithEqualizer() {
      const [element, setElement] = useState<HTMLAudioElement | null>(null)
      return <><PlayerBar audio={element} onAudioElement={next => {
        setElement(next)
        if (next) audio = next as unknown as TestAudio
      }} /><EqualizerPanel audio={element} /></>
    }
    await act(async () => root.render(<PlayerWithEqualizer />))
    await ready()
    await act(async () => usePlayerStore.getState().seek(52))
    const checkbox = container.querySelector<HTMLInputElement>('input[role="switch"]')!
    for (let i = 0; i < 2; i++) {
      await act(async () => checkbox.click())
      expect(checkbox.checked).toBe(true)
      const original = audio
      expect(getExistingAnalysisPipeline(original as unknown as HTMLAudioElement)).not.toBeNull()
      await act(async () => checkbox.click())
      expect(checkbox.checked).toBe(false)
      expect(audio).not.toBe(original)
      expect(getExistingAnalysisPipeline(audio as unknown as HTMLAudioElement)).toBeNull()
      await ready()
      expect(audio.currentTime).toBe(52)
      expect(audio.load).toHaveBeenCalledOnce()
    }
  })

  it('反复开关 EQ 释放每条旧链路，关闭后手势不会重新接管', async () => {
    for (let i = 0; i < 3; i++) {
      const pipeline = await enableEq()
      const original = audio
      await act(async () => useEqualizerStore.getState().update({ enabled: false }))
      await ready()
      expect(audio).not.toBe(original)
      expect(pipeline.context.close).toHaveBeenCalledOnce()
      await act(async () => window.dispatchEvent(new Event('click')))
      expect(getExistingAnalysisPipeline(audio as unknown as HTMLAudioElement)).toBeNull()
      expect(audio.load).toHaveBeenCalledOnce()
    }
  })

  it('iPadOS 桌面 UA 关闭 EQ 也恢复原生通道', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 })
    try {
      await enableEq()
      const original = audio
      await act(async () => useEqualizerStore.getState().update({ enabled: false }))
      expect(audio).not.toBe(original)
      expect(getExistingAnalysisPipeline(audio as unknown as HTMLAudioElement)).toBeNull()
    } finally { delete (navigator as { maxTouchPoints?: number }).maxTouchPoints }
  })

  it('桌面关闭 EQ 继续复用现有播放器和频谱链路', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Desktop')
    const pipeline = await enableEq()
    const original = audio
    await act(async () => useEqualizerStore.getState().update({ enabled: false }))
    expect(audio).toBe(original)
    expect(getExistingAnalysisPipeline(audio as unknown as HTMLAudioElement)).toBe(pipeline)
    expect(pipeline.context.close).not.toHaveBeenCalled()
  })

  it('尚未接管音频时关闭 EQ 不重建播放器', async () => {
    const original = audio
    await act(async () => {
      useEqualizerStore.getState().update({ enabled: true })
      useEqualizerStore.getState().update({ enabled: false })
    })
    expect(audio).toBe(original)
    expect(audio.paused).toBe(false)
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  usePlayerStore.getState().clearSleepTimer()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PC 与移动端共用播放器', () => {
  it('桌面和手机共享三种模式名称，从任一入口切换都会同步', async () => {
    await click(container.querySelector('button[aria-label="更多"]'))
    const mobileMode = () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('播放模式'))!
    for (const [index, label] of ['列表循环', '单曲循环', '随机播放', '列表循环'].entries()) {
      const desktopMode = container.querySelector(`button[aria-label="${label}"]`)
      expect(desktopMode).not.toBeNull()
      expect(mobileMode().textContent).toContain(label)
      if (index < 3) await click(index === 1 ? mobileMode() : desktopMode)
    }
  })

  it.each([
    { entry: '恢复播放', resume: false },
    { entry: '恢复播放', resume: true },
    { entry: '首次选歌', resume: false },
  ])('$entry 等待缓存时可通过按钮暂停，再次继续=$resume 时复用同一查询', async ({ entry, resume }) => {
    const auth = useAuthStore.getState()
    let resolve!: (value: { url: string; quality: '320k' }) => void
    const pending = new Promise<{ url: string; quality: '320k' }>(done => { resolve = done })
    const readCache = vi.spyOn(offlineAudio, 'getOfflineAudio').mockReturnValue(pending)
    vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
    try {
      await act(async () => {
        useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null, loading: false })
        usePlayerStore.getState().restorePlayback({ queue: [track], playNextQueue: [], currentIndex: 0,
          currentTrack: track, currentTime: 42, isCurrentTempPlay: false })
      })
      if (entry === '恢复播放') await click(container.querySelector('button[aria-label="播放"]'))
      else await act(async () => { void usePlayerStore.getState().playTrack(second, [second]) })
      expect(usePlayerStore.getState()).toMatchObject({ isFetchingUrl: true, isPlaying: true })
      await click(container.querySelector('button[aria-label="暂停"]'))
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      if (resume) await click(container.querySelector('button[aria-label="播放"]'))
      expect(readCache).toHaveBeenCalledOnce()
      await act(async () => {
        resolve({ url: 'blob:pending-playback', quality: '320k' })
        await pending
      })
      await ready()
      expect(audio.src).toBe('blob:pending-playback')
      expect(audio.paused).toBe(!resume)
      expect(usePlayerStore.getState()).toMatchObject({ isFetchingUrl: false, isPlaying: resume,
        currentTime: entry === '恢复播放' ? 42 : 0 })
      expect(readCache).toHaveBeenCalledOnce()
    } finally { await act(async () => { useAuthStore.setState(auth, true) }) }
  })

  it.each(['pause-and-seek', 'switch-track'])('等待 SW 登记期间仍尊重用户的 %s 操作', async action => {
    const auth = useAuthStore.getState()
    let resolve!: (ready: boolean) => void
    const cancel = vi.fn()
    const capture = { ready: new Promise<boolean>(done => { resolve = done }), response: Promise.resolve(null), cancel, cached: vi.fn() }
    vi.spyOn(playbackResponse, 'preparePlaybackResponse').mockReturnValueOnce(capture).mockReturnValue(null)
    try {
      await act(async () => {
        useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null, loading: false, mustChangePassword: false })
        await usePlayerStore.getState().playTrack(second, [track, second])
      })
      expect(audio.src).toBe('')
      await act(async () => {
        if (action === 'pause-and-seek') {
          usePlayerStore.getState().setIsPlaying(false)
          usePlayerStore.getState().seek(75)
        } else await usePlayerStore.getState().playTrack(track, [track, second])
      })
      await act(async () => { resolve(true) })
      await ready()
      if (action === 'pause-and-seek') {
        expect(audio.src).toContain('kw-second')
        expect(audio.currentTime).toBe(75)
        expect(audio.paused).toBe(true)
      } else {
        expect(audio.src).toContain('kw-first')
        expect(cancel).toHaveBeenCalled()
      }
    } finally { await act(async () => { useAuthStore.setState(auth, true) }) }
  })

  it.each(['reconnect', 'same-state'])('同账号认证成功后重新触发当前歌曲缓存（%s），不重新加载音频', async mode => {
    const auth = useAuthStore.getState()
    vi.useFakeTimers()
    const cache = vi.spyOn(offlineAudio, 'cachePlayedTrack').mockResolvedValue()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    try {
      await act(async () => {
        useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null, loading: false, mustChangePassword: false })
        await usePlayerStore.getState().loadStreamUrl(track)
      })
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(cache).toHaveBeenCalledTimes(1)
      const url = audio.src
      const loads = audio.load.mock.calls.length
      if (mode === 'reconnect') {
        await act(async () => {
          online.mockReturnValue(false)
          offlineAudio.cancelOfflineDownloads()
          useAuthStore.setState({ authenticated: null, username: null, offlineUsername: 'alice' })
        })
        await act(async () => {
          online.mockReturnValue(true)
          useAuthStore.setState({ loading: true })
        })
        await act(async () => { vi.advanceTimersByTime(3000) })
        expect(cache).toHaveBeenCalledTimes(1)
      }
      await act(async () => {
        useAuthStore.setState(state => ({ authenticated: true, username: 'alice', offlineUsername: null,
          loading: false, sessionRevision: state.sessionRevision + 1 }))
      })
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(cache).toHaveBeenCalledTimes(2)
      expect(cache).toHaveBeenLastCalledWith('alice', track, '320k')
      expect(audio.src).toBe(url)
      expect(audio.load).toHaveBeenCalledTimes(loads)
    } finally { await act(async () => { useAuthStore.setState(auth, true) }) }
  })

  it.each(['paused', 'other-account', 'expired', 'must-change-password', 'blob'])('重新认证时遇到 %s，不给当前音频重复或跨账号缓存', async reason => {
    const auth = useAuthStore.getState()
    vi.useFakeTimers()
    const cache = vi.spyOn(offlineAudio, 'cachePlayedTrack').mockResolvedValue()
    vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
    try {
      await act(async () => {
        useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null, loading: false, mustChangePassword: false })
        await usePlayerStore.getState().loadStreamUrl(track)
      })
      await act(async () => { vi.advanceTimersByTime(3000) })
      cache.mockClear()
      await act(async () => {
        if (reason === 'paused') usePlayerStore.getState().setIsPlaying(false)
        if (reason === 'blob') usePlayerStore.setState({ streamUrl: 'blob:local' })
        useAuthStore.setState(state => ({ authenticated: reason !== 'expired', username: reason === 'other-account' ? 'bob' : 'alice',
          mustChangePassword: reason === 'must-change-password', sessionRevision: state.sessionRevision + 1 }))
      })
      await ready()
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(cache).not.toHaveBeenCalled()
    } finally { await act(async () => { useAuthStore.setState(auth, true) }) }
  })

  it.each(['blob', 'network'])('切到 B 的缓存读取期间立即丢弃 A 的结束、进度及错误事件（%s）', async result => {
    const auth = useAuthStore.getState()
    await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null }) })
    const third = makeTrack('third')
    let resolve!: (value: { url: string; quality: '320k' } | null) => void
    vi.spyOn(offlineAudio, 'getOfflineAudio').mockImplementationOnce(() => new Promise(done => { resolve = done }))
    vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
    vi.stubGlobal('MediaError', { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2,
      MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 })
    let loading!: Promise<void>
    try {
      await act(async () => {
        loading = usePlayerStore.getState().playTrack(second, [track, second, third])
        // 不等待 React 提交或缓存返回，模拟紧接点击发生的旧音频事件。
        expect(audio.src).toBe('')
        expect(audio.paused).toBe(true)
        audio.currentTime = 179
        audio.duration = 999
        audio.readyState = 4
        audio.dispatchEvent(new Event('timeupdate'))
        audio.dispatchEvent(new Event('durationchange'))
        audio.error = { code: 2 }
        audio.dispatchEvent(new Event('error'))
        endAudio()
      })
      expect(usePlayerStore.getState()).toMatchObject({ currentTrack: second, currentIndex: 1,
        currentTime: 0, duration: second.duration, isFetchingUrl: true, isPlaying: true, urlFetchError: null })
      expect(offlineAudio.getOfflineAudio).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolve(result === 'blob' ? { url: 'blob:second', quality: '320k' } : null)
        await loading
      })
      await ready(second.duration)
      expect(audio.src).toBe(result === 'blob' ? 'blob:second' : '/api/audio?uid=kw-second&quality=320k&v=2')
      expect(audio.currentTime).toBe(0)
      expect(usePlayerStore.getState()).toMatchObject({ currentTrack: second, currentIndex: 1, isPlaying: true })
    } finally { await act(async () => { useAuthStore.setState(auth, true) }) }
  })

  it('网络音频错误事件触发后从本地 Blob 恢复原曲目和拖动进度', async () => {
    const auth = useAuthStore.getState()
    await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null }) })
    vi.spyOn(offlineAudio, 'getOfflineAudio').mockResolvedValue({ url: 'blob:recovered', quality: '320k' })
    vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
    vi.stubGlobal('MediaError', { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2,
      MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 })
    try {
      await act(async () => { usePlayerStore.getState().seek(145) })
      expect(usePlayerStore.getState().isPlaying).toBe(true)
      const onError = vi.spyOn(usePlayerStore.getState(), 'handleTrackError')
      await act(async () => {
        audio.error = { code: 2 }
        audio.dispatchEvent(new Event('error'))
      })
      expect(onError).toHaveBeenCalledWith(expect.any(String), 2, true)
      expect(offlineAudio.getOfflineAudio).toHaveBeenCalledExactlyOnceWith('alice', track.uid, '320k', ['320k'])
      expect(usePlayerStore.getState().streamUrl).toBe('blob:recovered')
      await ready()
      expect(audio.src).toBe('blob:recovered')
      expect(audio.currentTime).toBe(145)
      expect(audio.paused).toBe(false)
      expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, isPlaying: true, currentTime: 145 })
      expect(offlineAudio.getOfflineAudio).toHaveBeenCalledExactlyOnceWith('alice', track.uid, '320k', ['320k'])
    } finally {
      await act(async () => { useAuthStore.setState(auth, true) })
    }
  })

  it.each(['PC', '手机'])('%s 入口启用单曲循环后连续两次结束都真正重播', async device => {
    if (device === 'PC') {
      await click(container.querySelector('button[aria-label="列表循环"]'))
    } else {
      await click(container.querySelector('button[aria-label="更多"]'))
      await click([...container.querySelectorAll('button')].find(b => b.textContent?.includes('播放模式')) ?? null)
    }
    expect(usePlayerStore.getState().playbackMode).toBe('loop')
    const plays = audio.play.mock.calls.length
    const loads = audio.load.mock.calls.length
    for (let i = 1; i <= 2; i++) {
      await act(async () => { endAudio() })
      expect(audio.play).toHaveBeenCalledTimes(plays + i)
      expect(audio.currentTime).toBe(0)
      expect(audio.paused).toBe(false)
      expect(usePlayerStore.getState().isPlaying).toBe(true)
      expect(usePlayerStore.getState().duration).toBe(180)
    }
    expect(audio.load).toHaveBeenCalledTimes(loads)
  })

  it('再次播放同曲保留真实时长并从头播放，不依赖新的元数据事件', async () => {
    const loads = audio.load.mock.calls.length
    audio.currentTime = 43
    await act(async () => { await usePlayerStore.getState().playTrack(track, [track]) })
    expect(audio.currentTime).toBe(0)
    await act(async () => { audio.currentTime = 43; audio.dispatchEvent(new Event('timeupdate')) })
    expect(audio.load).toHaveBeenCalledTimes(loads)
    expect(usePlayerStore.getState().duration).toBe(180)
    expect(container.textContent).toContain('0:43')
    expect(container.textContent).toContain('3:00')
  })

  it('尚无有限音频时长时使用曲目时长，后续元数据覆盖估值', async () => {
    await act(async () => { await usePlayerStore.getState().playTrack(second, [second]) })
    await ready(Infinity)
    expect(usePlayerStore.getState().duration).toBe(190)
    await act(async () => { audio.duration = 181; audio.dispatchEvent(new Event('durationchange')) })
    expect(usePlayerStore.getState().duration).toBe(181)
  })

  it('缺失或无效曲目时长不会产生 NaN/Infinity', async () => {
    await act(async () => { await usePlayerStore.getState().playTrack(makeTrack('unknown', 'invalid')) })
    await ready(NaN)
    expect(usePlayerStore.getState().duration).toBe(0)
  })

  it('只有插播歌曲而无主队列时仍可单曲循环', async () => {
    await act(async () => { usePlayerStore.getState().clearQueue() })
    await act(async () => {
      usePlayerStore.getState().addToQueue(track)
      usePlayerStore.setState({ playbackMode: 'loop' })
    })
    await ready()
    expect(usePlayerStore.getState().queue).toHaveLength(0)
    const plays = audio.play.mock.calls.length
    await act(async () => { endAudio() })
    expect(audio.play).toHaveBeenCalledTimes(plays + 1)
    expect(audio.paused).toBe(false)
  })

  it('插播队列优先于单曲循环，并加载下一首', async () => {
    await act(async () => {
      usePlayerStore.setState({ playbackMode: 'loop' })
      usePlayerStore.getState().addNext(second)
    })
    await act(async () => { endAudio() })
    expect(usePlayerStore.getState().currentTrack?.uid).toBe(second.uid)
    expect(audio.src).toContain('kw-second')
    expect(usePlayerStore.getState().playNextQueue).toHaveLength(0)
  })

  it('列表循环只有一首时，结束后从头继续播放', async () => {
    const plays = audio.play.mock.calls.length
    await act(async () => { endAudio() })
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalledTimes(plays + 1)
  })

  it('列表循环播到队尾后回到第一首，并继续下一轮', async () => {
    await act(async () => { await usePlayerStore.getState().playTrack(second, [track, second]) })
    await ready()
    await act(async () => { endAudio() })
    expect(usePlayerStore.getState()).toMatchObject({ currentIndex: 0, isPlaying: true })
    expect(audio.src).toContain('kw-first')
    expect(audio.paused).toBe(false)
    await ready()
    await act(async () => { endAudio() })
    expect(usePlayerStore.getState()).toMatchObject({ currentIndex: 1, isPlaying: true })
    expect(audio.src).toContain('kw-second')
    expect(audio.paused).toBe(false)
  })

  it('队尾连续插播两首后回到主队列首曲，插播不加入下一轮', async () => {
    const extraA = makeTrack('extra-a')
    const extraB = makeTrack('extra-b')
    await act(async () => {
      await usePlayerStore.getState().playTrack(second, [track, second])
      usePlayerStore.getState().addToQueue(extraA)
      usePlayerStore.getState().addToQueue(extraB)
    })
    await ready()
    for (const expected of [extraA, extraB, track, second, track]) {
      await act(async () => endAudio())
      expect(usePlayerStore.getState().currentTrack?.uid).toBe(expected.uid)
      expect(audio.src).toContain(expected.uid)
      expect(audio.paused).toBe(false)
      expect(usePlayerStore.getState().queue).toEqual([track, second])
      await ready()
    }
    expect(usePlayerStore.getState()).toMatchObject({ currentIndex: 0, isCurrentTempPlay: false, playNextQueue: [] })
  })

  it('队尾循环等待缓存时暂停，缓存返回后首曲保持暂停', async () => {
    await act(async () => usePlayerStore.getState().playTrack(second, [track, second]))
    await ready()
    const auth = useAuthStore.getState()
    let resolveCache!: (value: null) => void
    vi.spyOn(offlineAudio, 'getOfflineAudio').mockImplementationOnce(() => new Promise(resolve => { resolveCache = resolve }))
    try {
      await act(async () => {
        useAuthStore.setState({ username: 'alice', authenticated: false, offlineUsername: null })
        endAudio()
      })
      expect(usePlayerStore.getState()).toMatchObject({ currentIndex: 0, isFetchingUrl: true })
      await act(async () => usePlayerStore.getState().setIsPlaying(false))
      await act(async () => resolveCache(null))
      await ready()
      expect(usePlayerStore.getState()).toMatchObject({ currentIndex: 0, isPlaying: false, isFetchingUrl: false })
      expect(audio.paused).toBe(true)
    } finally {
      await act(async () => useAuthStore.setState(auth, true))
    }
  })

  it('暂停后拖动不会恢复播放，播放中拖动也不会重置到开头', async () => {
    await act(async () => { usePlayerStore.getState().seek(40) })
    expect(audio.currentTime).toBe(40)
    expect(audio.paused).toBe(false)
    await act(async () => { usePlayerStore.getState().togglePlay() })
    const plays = audio.play.mock.calls.length
    await act(async () => { usePlayerStore.getState().seek(75) })
    expect(audio.currentTime).toBe(75)
    expect(audio.paused).toBe(true)
    expect(audio.play).toHaveBeenCalledTimes(plays)
  })

  it('结束后立即暂停的意图优先于待执行的重播', async () => {
    await act(async () => { usePlayerStore.setState({ playbackMode: 'loop' }) })
    const plays = audio.play.mock.calls.length
    await act(async () => { endAudio(); usePlayerStore.getState().setIsPlaying(false) })
    expect(audio.paused).toBe(true)
    expect(audio.play).toHaveBeenCalledTimes(plays)
  })

  it('淡入期间切到后台会恢复目标音量，后台循环不依赖动画帧', async () => {
    hidden = false
    await act(async () => { usePlayerStore.setState({ playbackMode: 'loop' }); endAudio() })
    expect(audio.volume).toBe(0)
    await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(audio.volume).toBe(0.8)
    await act(async () => { endAudio() })
    expect(audio.paused).toBe(false)
    expect(audio.volume).toBe(0.8)
  })

  it('切换音质加载新源，清空队列停止播放', async () => {
    await act(async () => { usePlayerStore.getState().setQuality('128k') })
    expect(audio.src).toContain('quality=128k')
    await ready()
    await act(async () => { usePlayerStore.getState().clearQueue() })
    expect(audio.paused).toBe(true)
    expect(usePlayerStore.getState().duration).toBe(0)
  })

  it('加载期间暂停，迟到的 canplay/playing 不会重新拉起音频', async () => {
    await act(async () => { await usePlayerStore.getState().playTrack(second) })
    await act(async () => { usePlayerStore.getState().setIsPlaying(false) })
    await ready()
    expect(audio.paused).toBe(true)
    expect(usePlayerStore.getState().isPlaying).toBe(false)
  })

  it('随机模式只有一首歌时也能继续播放同一 URL', async () => {
    await act(async () => { usePlayerStore.setState({ playbackMode: 'random' }) })
    const plays = audio.play.mock.calls.length
    await act(async () => { endAudio() })
    expect(audio.play).toHaveBeenCalledTimes(plays + 1)
    expect(audio.currentTime).toBe(0)
  })

  it.each(['PC', '手机'])('%s 随机播放通过实际音频事件记录历史，重播后可回退并再次前进', async device => {
    const songs = [track, second, makeTrack('third'), makeTrack('fourth')]
    await act(async () => {
      usePlayerStore.getState().setPlaybackMode('random')
      await usePlayerStore.getState().playTrack(track, songs)
    })
    await ready()
    if (device === '手机') await click(container.querySelector('button[aria-label="更多"]'))
    const transport = (label: string) => device === '手机'
      ? document.querySelector(`dialog button[aria-label="${label}"]`)
      : container.querySelector(`button[aria-label="${label}"]`)
    await click(transport('下一首'))
    await ready()
    const target = usePlayerStore.getState().currentTrack!
    await act(async () => usePlayerStore.getState().seek(25))
    await click(transport('上一首'))
    expect(audio.currentTime).toBe(0)
    expect(usePlayerStore.getState().currentTrack?.uid).toBe(target.uid)
    await click(transport('上一首'))
    await ready()
    expect(usePlayerStore.getState().currentTrack?.uid).toBe(track.uid)
    await click(transport('下一首'))
    await ready()
    expect(usePlayerStore.getState().currentTrack?.uid).toBe(target.uid)
    expect(audio.src).toContain(target.uid)
    expect(audio.paused).toBe(false)
  })

  it('只发出 play 尚未 playing 的歌曲不进入回退历史', async () => {
    const third = makeTrack('third')
    await act(async () => usePlayerStore.getState().playTrack(track, [track, second, third]))
    await ready()
    await act(async () => usePlayerStore.getState().next())
    await act(async () => audio.dispatchEvent(new Event('play')))
    await act(async () => usePlayerStore.getState().next())
    await ready()
    await act(async () => usePlayerStore.getState().previous())
    await ready()
    expect(usePlayerStore.getState().currentTrack?.uid).toBe(track.uid)
  })

  it('单曲循环保持解码失败后实际降级的音质', async () => {
    await act(async () => {
      usePlayerStore.setState({ playbackMode: 'loop' })
      usePlayerStore.getState().handleTrackError('decode failure', 3)
    })
    await ready()
    const url = audio.src
    expect(url).toContain('128k')
    await act(async () => { endAudio() })
    expect(audio.src).toBe(url)
    expect(usePlayerStore.getState().effectiveQuality).toBe('128k')
  })

  it('StrictMode 重建 Audio 后仍加载当前歌曲', async () => {
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await act(async () => {
      root.render(<StrictMode><PlayerBar audio={null} onAudioElement={a => { if (a) audio = a as unknown as TestAudio }} /></StrictMode>)
    })
    expect(audio.src).toContain('kw-first')
    await ready()
    expect(audio.paused).toBe(false)
  })

  it('恢复后保持暂停，点击继续等待元数据再跳到原进度', async () => {
    await act(async () => {
      usePlayerStore.getState().restorePlayback({ queue: [track], playNextQueue: [], currentIndex: 0,
        currentTrack: track, isCurrentTempPlay: false, currentTime: 92 })
    })
    const plays = audio.play.mock.calls.length
    expect(audio.src).toBe('')
    expect(audio.paused).toBe(true)
    expect(container.textContent).toContain('1:32')
    await act(async () => { usePlayerStore.getState().togglePlay() })
    expect(audio.play).toHaveBeenCalledTimes(plays + 1)
    expect(usePlayerStore.getState().currentTime).toBe(92)
    await ready()
    expect(audio.currentTime).toBe(92)
    expect(usePlayerStore.getState().currentTime).toBe(92)
    expect(audio.paused).toBe(false)
  })

  it('恢复后拖动进度，再继续播放使用新的位置', async () => {
    await act(async () => {
      usePlayerStore.getState().restorePlayback({ queue: [track], playNextQueue: [], currentIndex: 0,
        currentTrack: track, isCurrentTempPlay: false, currentTime: 92 })
    })
    await act(async () => { usePlayerStore.getState().seek(110) })
    expect(audio.src).toBe('')
    await act(async () => { usePlayerStore.getState().togglePlay() })
    await ready()
    expect(audio.currentTime).toBe(110)
  })

  it('恢复尚未完成就切歌，不把旧进度应用到新歌曲', async () => {
    await act(async () => {
      usePlayerStore.getState().restorePlayback({ queue: [track, second], playNextQueue: [], currentIndex: 0,
        currentTrack: track, isCurrentTempPlay: false, currentTime: 92 })
    })
    await act(async () => { usePlayerStore.getState().togglePlay() })
    await act(async () => { usePlayerStore.getState().next() })
    await ready()
    expect(audio.src).toContain('kw-second')
    expect(audio.currentTime).toBe(0)
  })

  it('暂停时切音质保留位置，加载后仍暂停', async () => {
    await act(async () => { usePlayerStore.getState().seek(75); usePlayerStore.getState().setIsPlaying(false) })
    await act(async () => { usePlayerStore.getState().setQuality('128k') })
    await ready()
    expect(audio.currentTime).toBe(75)
    expect(audio.paused).toBe(true)
    expect(usePlayerStore.getState().isPlaying).toBe(false)
  })

  it('恢复遇到解码降级仍保留位置，暂停加载失败不会自动跳歌', async () => {
    await act(async () => { usePlayerStore.getState().seek(92) })
    await act(async () => { usePlayerStore.getState().handleTrackError('decode', 3, true) })
    await ready()
    expect(audio.currentTime).toBe(92)
    expect(audio.src).toContain('quality=128k')
    await act(async () => { usePlayerStore.getState().handleTrackError('network', 2, false) })
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: { uid: track.uid }, currentTime: 92, isPlaying: false })
    expect(audio.src).toBe('')
  })

  it('首次交互不会重新加载已恢复的音频', async () => {
    await act(async () => { root.unmount() })
    usePlayerStore.getState().restorePlayback({ queue: [track], playNextQueue: [], currentIndex: 0,
      currentTrack: track, isCurrentTempPlay: false, currentTime: 92 })
    root = createRoot(container)
    await act(async () => { root.render(<PlayerBar audio={null} onAudioElement={a => { if (a) audio = a as unknown as TestAudio }} />) })
    await act(async () => { usePlayerStore.getState().togglePlay() })
    await ready()
    const loads = audio.load.mock.calls.length
    await act(async () => { window.dispatchEvent(new Event('click')) })
    expect(audio.load).toHaveBeenCalledTimes(loads)
    expect(audio.currentTime).toBe(92)
  })
})
