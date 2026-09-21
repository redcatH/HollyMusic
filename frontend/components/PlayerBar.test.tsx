import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerBar } from '@/components/player/PlayerBar'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'

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
  paused = true
  ended = false
  readyState = 0
  duration = NaN
  currentTime = 0
  error = null
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
  vi.stubGlobal('Audio', TestAudio)
  // 不执行 rAF：同时验证后台冻结动画时播放命令仍然有效。
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  hidden = true
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
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

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  usePlayerStore.getState().clearSleepTimer()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PC 与移动端共用播放器', () => {
  it.each(['PC', '手机'])('%s 入口启用单曲循环后连续两次结束都真正重播', async device => {
    if (device === 'PC') {
      await click(container.querySelector('button[aria-label="顺序播放"]'))
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

  it('顺序播放到队尾停止，不误触发循环', async () => {
    const plays = audio.play.mock.calls.length
    await act(async () => { endAudio() })
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(audio.paused).toBe(true)
    expect(audio.play).toHaveBeenCalledTimes(plays)
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
})
