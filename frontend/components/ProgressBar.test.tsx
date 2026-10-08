import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressBar } from '@/components/player/ProgressBar'

let container: HTMLDivElement
let root: Root
const change = vi.fn()

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  change.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ProgressBar value={20} onChange={change} />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function input(value: number) {
  const slider = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(value))
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('可触摸和键盘操作的进度条', () => {
  it('原生键盘产生的值变化立即提交', async () => {
    await input(21)
    expect(change).toHaveBeenCalledWith(21)
    expect(container.querySelector('input')?.getAttribute('aria-label')).toBe('播放进度')
  })

  it.each(['touch', 'mouse'])('%s 拖动只在松开时提交最终值', async pointerType => {
    const slider = container.querySelector('input')!
    slider.setPointerCapture = vi.fn()
    const pointer = (type: string) => Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, pointerType })
    await act(async () => slider.dispatchEvent(pointer('pointerdown')))
    await input(45)
    await input(70)
    expect(change).not.toHaveBeenCalled()
    await act(async () => slider.dispatchEvent(pointer('pointerup')))
    expect(change).toHaveBeenCalledExactlyOnceWith(70)
  })

  it('取消触摸恢复原值且不跳转', async () => {
    const slider = container.querySelector('input')!
    slider.setPointerCapture = vi.fn()
    await act(async () => slider.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await input(80)
    await act(async () => slider.dispatchEvent(new Event('pointercancel', { bubbles: true })))
    expect(slider.value).toBe('20')
    expect(change).not.toHaveBeenCalled()
  })
})
