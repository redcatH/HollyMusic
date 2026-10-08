import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceButton } from '../src/components/AppearanceSettings'
import { ThemeProvider } from '../src/components/ThemeProvider'
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, parseAppearance, useAppearanceStore } from '@/lib/store/appearance-store'

let container: HTMLDivElement
let root: Root
let media: MediaQueryList
const bootstrap = readFileSync(resolve(__dirname, '../../public/theme-init.js'), 'utf8')

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  media = Object.assign(new EventTarget(), { matches: false, media: '(prefers-color-scheme: dark)' }) as MediaQueryList
  vi.stubGlobal('matchMedia', () => media)
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#f3f7f3' }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new Event('close'))
  } })
  localStorage.clear()
  useAppearanceStore.setState({ ...DEFAULT_APPEARANCE, systemDark: false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ThemeProvider><AppearanceButton /></ThemeProvider>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openSettings() {
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
}

describe('外观设置', () => {
  it('切换明暗、配色与氛围后立即应用并保存，关闭重开仍选中', async () => {
    await openSettings()
    await act(async () => container.querySelector<HTMLInputElement>('input[value="dark"]')!.click())
    await act(async () => container.querySelector<HTMLInputElement>('input[value="blue"]')!.click())
    await act(async () => container.querySelector<HTMLInputElement>('input[role="switch"]')!.click())
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.palette).toBe('blue')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY)!)).toEqual({ mode: 'dark', palette: 'blue', coverAtmosphere: false })
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="关闭外观设置"]')!.click())
    expect(container.querySelector('dialog')).toBeNull()
    await openSettings()
    expect(container.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[value="blue"]')!.checked).toBe(true)
  })

  it('跟随系统实时变化，手动选择不被系统覆盖', async () => {
    await act(async () => {
      Object.assign(media, { matches: true })
      media.dispatchEvent(new Event('change'))
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
    await act(async () => useAppearanceStore.getState().update({ mode: 'light' }))
    await act(async () => media.dispatchEvent(new Event('change')))
    expect(document.documentElement.dataset.theme).toBe('light')
    await act(async () => useAppearanceStore.getState().update({ mode: 'system' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('同步另一个标签页的偏好，清空存储时恢复默认', async () => {
    await act(async () => window.dispatchEvent(new StorageEvent('storage', {
      key: APPEARANCE_STORAGE_KEY,
      newValue: JSON.stringify({ mode: 'dark', palette: 'apricot', coverAtmosphere: false }),
      storageArea: localStorage,
    })))
    expect(document.documentElement.dataset.palette).toBe('apricot')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(useAppearanceStore.getState().coverAtmosphere).toBe(false)
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null, storageArea: localStorage })))
    expect(document.documentElement.dataset.palette).toBe('forest')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('浏览器禁止写入存储时，主题仍可以切换', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError') })
    await openSettings()
    await act(async () => container.querySelector<HTMLInputElement>('input[value="dark"]')!.click())
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(container.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true)
  })

  it('外观弹窗的键盘操作不会触发播放器全局快捷键', async () => {
    await openSettings()
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
    expect(onKey).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onKey)
  })
})

describe('首屏主题恢复', () => {
  const savedSettings = [null, '{broken', 'null', '42', '[]', '{"mode":"invalid","palette":"invalid"}',
    ...['system', 'light', 'dark'].flatMap(mode => ['forest', 'blue', 'apricot'].map(palette => JSON.stringify({ mode, palette, coverAtmosphere: false }))),
  ]

  it.each(savedSettings)('首屏脚本与 React 状态对 %s 的恢复一致', raw => {
    for (const systemDark of [true, false]) {
      const doc = document.implementation.createHTMLDocument()
      const execute = new Function('document', 'localStorage', 'matchMedia', bootstrap)
      execute(doc, { getItem: () => raw }, () => ({ matches: systemDark }))
      const expected = parseAppearance(raw)
      const dark = expected.mode === 'dark' || (expected.mode === 'system' && systemDark)
      expect(doc.documentElement.dataset.theme).toBe(dark ? 'dark' : 'light')
      expect(doc.documentElement.dataset.palette).toBe(expected.palette)
    }
  })

  it('禁用存储时，首屏仍跟随系统深色模式', () => {
    const doc = document.implementation.createHTMLDocument()
    new Function('document', 'localStorage', 'matchMedia', bootstrap)(doc, { getItem: () => { throw new Error('Denied') } }, () => ({ matches: true }))
    expect(doc.documentElement.dataset.theme).toBe('dark')
  })
})
