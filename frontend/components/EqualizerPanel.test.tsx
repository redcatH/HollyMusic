import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { EqualizerPanel } from '@/components/player/EqualizerPanel'
import { attachAnalysisPipeline, bindEqualizerLifecycle } from '@/lib/client/audio-analysis'
import { defaultEqualizer } from '@/lib/client/equalizer'
import { useEqualizerStore } from '@/lib/store/equalizer-store'

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useEqualizerStore.setState({ settings: defaultEqualizer(), saved: [], status: 'idle', sampleRate: 48000 })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<EqualizerPanel audio={null} />))
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
  const path = container.querySelector('svg[role="img"] path[stroke="currentColor"]')!.getAttribute('d')
  await input('input[aria-label="1000 Hz 增益"]', '8')
  expect(useEqualizerStore.getState().settings.bands[5]).toBe(8)
  expect(select.value).toBe('custom')
  expect(container.querySelector('svg[role="img"] path[stroke="currentColor"]')!.getAttribute('d')).not.toBe(path)
  await act(async () => container.querySelector<HTMLInputElement>('input[role="switch"]')!.click())
  expect(useEqualizerStore.getState().settings.enabled).toBe(false)
  expect(useEqualizerStore.getState().settings.bands[5]).toBe(8)
})
it('通过面板保存、选择和删除自定义预设', async () => {
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click())
  await input('input[aria-label="手动前级增益"]', '-3')
  await input('input[aria-label="自定义预设名称"]', '夜间')
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useEqualizerStore.getState().saved[0].name).toBe('夜间')
  expect(container.textContent).toContain('夜间')
  await input('input[aria-label="手动前级增益"]', '-6')
  await act(async () => container.querySelector<HTMLButtonElement>('li button')!.click())
  expect(useEqualizerStore.getState().settings.preamp).toBe(-3)
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
      root.render(<EqualizerPanel audio={audio} />)
    })
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

it('分组微调与单段归零保留其他频段，受采样率限制的频段无法调整', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="提高 31 Hz 增益"]')!.click())
  expect(useEqualizerStore.getState().settings.bands[0]).toBe(0.5)
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[aria-label="频段范围"] button')[1].click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="降低 1000 Hz 增益"]')!.click())
  expect(useEqualizerStore.getState().settings.bands[5]).toBe(-0.5)
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="重置 1000 Hz 增益"]')!.click())
  expect(useEqualizerStore.getState().settings.bands[5]).toBe(0)
  expect(useEqualizerStore.getState().settings.bands[0]).toBe(0.5)
  await act(async () => useEqualizerStore.setState({ sampleRate: 22050 }))
  expect(container.querySelector<HTMLInputElement>('input[aria-label="16000 Hz 增益"]')!.disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="重置 16000 Hz 增益"]')!.disabled).toBe(true)
})

it('标签页支持方向键和焦点切换，不触发全局播放器快捷键', async () => {
  const globalKey = vi.fn()
  window.addEventListener('keydown', globalKey)
  try {
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await act(async () => {
      tabs[0].focus()
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])
    expect(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')[0].hidden).toBe(true)
    expect(globalKey).not.toHaveBeenCalled()
  } finally { window.removeEventListener('keydown', globalKey) }
})
