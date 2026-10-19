import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { EqualizerButton, EqualizerPanel } from '@/components/player/EqualizerPanel'
import { attachAnalysisPipeline, bindEqualizerLifecycle } from '@/lib/client/audio-analysis'
import { defaultEqualizer } from '@/lib/client/equalizer'
import { useEqualizerStore } from '@/lib/store/equalizer-store'

let root: Root
let container: HTMLDivElement
const onClose = vi.fn()
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  useEqualizerStore.setState({ settings: defaultEqualizer(), saved: [], status: 'idle' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<EqualizerPanel audio={null} onClose={onClose} />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function input(selector: string, value: string) {
  const node = container.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('面板实时调整频段、预设和频响，关闭开关保留参数', async () => {
  expect(container.querySelectorAll('input[type="range"]')).toHaveLength(11)
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'rock'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(useEqualizerStore.getState().settings.preset).toBe('rock')
  await act(async () => container.querySelector<HTMLInputElement>('input[role="switch"]')!.click())
  const path = container.querySelector('path[stroke="currentColor"]')!.getAttribute('d')
  await input('input[aria-label="1000 Hz 增益"]', '8')
  expect(useEqualizerStore.getState().settings.bands[5]).toBe(8)
  expect(select.value).toBe('custom')
  expect(container.querySelector('path[stroke="currentColor"]')!.getAttribute('d')).not.toBe(path)
  await act(async () => container.querySelector<HTMLInputElement>('input[role="switch"]')!.click())
  expect(useEqualizerStore.getState().settings.enabled).toBe(false)
  expect(useEqualizerStore.getState().settings.bands[5]).toBe(8)
})
it('通过面板保存、选择和删除自定义预设', async () => {
  await input('input[aria-label="自定义预设名称"]', '夜间')
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useEqualizerStore.getState().saved[0].name).toBe('夜间')
  expect(container.textContent).toContain('夜间')
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="删除预设 夜间"]')!.click())
  expect(useEqualizerStore.getState().saved).toHaveLength(0)
})

it.each([
  { platform: '桌面', userAgent: 'Desktop', enabled: false },
  { platform: 'iOS', userAgent: 'iPhone', enabled: true },
])('$platform 播放器已有音频链路时可通过复选框和标签反复开关 EQ', async ({ userAgent, enabled: initialEnabled }) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  const param = () => ({ value: 0, cancelAndHoldAtTime() {}, setValueAtTime() {}, setTargetAtTime() {} })
  const node = () => ({ gain: param(), frequency: param(), Q: param(), connect() {}, disconnect() {} })
  class Context extends EventTarget {
    state = 'running'
    currentTime = 0
    sampleRate = 48000
    destination = node()
    createAnalyser = node
    createGain = node
    createBiquadFilter = node
    createMediaElementSource = node
    resume = async () => {}
    close = async () => {}
  }
  vi.stubGlobal('AudioContext', Context)
  const audio = new Audio()
  const cleanup = bindEqualizerLifecycle(audio)
  const updates: boolean[] = []
  const unsubscribe = useEqualizerStore.subscribe(state => updates.push(state.settings.enabled))
  try {
    await act(async () => {
      useEqualizerStore.getState().update({ enabled: initialEnabled })
      useEqualizerStore.getState().selectPreset('rock')
      await attachAnalysisPipeline(audio)
      root.render(<EqualizerButton audio={audio} />)
    })
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="均衡器"]')!.click())
    const checkbox = container.querySelector<HTMLInputElement>('input[role="switch"]')!
    const bands = useEqualizerStore.getState().settings.bands
    for (const target of [checkbox, checkbox.closest('label')!, checkbox, checkbox.closest('label')!]) {
      const enabled = !useEqualizerStore.getState().settings.enabled
      updates.length = 0
      await act(async () => target.click())
      // 音频状态通知必须在 React 提交勾选值之后，避免原生点击中的 checked 被旧值覆盖。
      if (target === checkbox) expect(updates[0]).toBe(enabled)
      expect(useEqualizerStore.getState().settings.enabled).toBe(enabled)
      expect(checkbox.checked).toBe(enabled)
      expect(useEqualizerStore.getState().settings.bands).toEqual(bands)
    }
  } finally { unsubscribe(); cleanup() }
})
