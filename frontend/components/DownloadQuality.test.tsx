import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SongRow } from '@/components/shared/SongRow'
import { SongContextMenu } from '@/components/shared/SongContextMenu'
import { useAuthStore } from '@/hooks/useAuth'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack, type QualityType } from '@/lib/types/player'

const { download } = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('@/hooks/useDownload', () => ({ useDownload: () => ({ download, downloading: false, error: null }) }))
vi.mock('@/components/shared/CoverImage', () => ({ CoverImage: () => null }))

const track = toTrack({
  uid: 'kw-download',
  musicInfo: {
    name: '下载测试', singer: '歌手', source: 'kw', songmid: 'download', interval: '03:00',
    types: [
      { type: '128k', size: '3M' }, { type: 'flac', size: '24M' },
      { type: '320k', size: '8M' }, { type: 'flac24bit', size: '48M' },
    ],
    _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {},
  },
})

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) } })
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), quality: '320k' }, true)
  useAuthStore.setState({ authenticated: true })
  useContextMenuStore.getState().dismiss()
  download.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useContextMenuStore.getState().dismiss()
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

async function click(element: Element) {
  await act(async () => { (element as HTMLElement).click() })
}

function button(text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(item => item.textContent === text)!
}

function radio(quality: QualityType): HTMLInputElement {
  return container.querySelector(`input[value="${quality}"]`)!
}

it('行内下载先选择音质，确认后传递所选档位，不改变播放偏好', async () => {
  await act(async () => root.render(<SongRow track={track} />))
  await click(container.querySelector('[aria-label="下载"]')!)
  expect(container.querySelector('dialog')?.open).toBe(true)
  expect(download).not.toHaveBeenCalled()
  expect([...container.querySelectorAll('input[type="radio"]')].map(item => item.getAttribute('value')))
    .toEqual(['flac24bit', 'flac', '320k', '128k'])
  expect(radio('320k').checked).toBe(true)
  expect(radio('flac24bit').closest('label')?.textContent).toContain('48M')

  await click(radio('flac24bit'))
  await click(button('开始下载'))
  expect(download).toHaveBeenCalledExactlyOnceWith({ uid: track.uid, quality: 'flac24bit' })
  expect(usePlayerStore.getState().quality).toBe('320k')
  expect(container.querySelector('dialog')).toBeNull()
})

it.each([false, true])('歌曲菜单进入音质弹窗，关闭菜单后仍能确认下载（移动端=%s）', async mobile => {
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  await act(async () => root.render(<SongContextMenu />))
  await act(async () => useContextMenuStore.getState().openMenu(track, 100, 100))
  await click(button('下载'))
  expect(useContextMenuStore.getState().menu).toBeNull()
  expect(container.querySelector('[role="menu"]')).toBeNull()
  expect(container.querySelector('dialog')?.open).toBe(true)
  expect(download).not.toHaveBeenCalled()
  await click(radio('flac'))
  await click(button('开始下载'))
  expect(download).toHaveBeenCalledExactlyOnceWith({ uid: track.uid, quality: 'flac' })
})

it('仅展示歌曲支持的档位，并在播放偏好不可用时选择较低音质', async () => {
  const limited = { ...track, musicInfo: { ...track.musicInfo, types: [{ type: '128k' as const, size: '3M' }] } }
  await act(async () => root.render(<SongRow track={limited} />))
  await click(container.querySelector('[aria-label="下载"]')!)
  expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1)
  expect(radio('128k').checked).toBe(true)
  await click(button('开始下载'))
  expect(download).toHaveBeenCalledExactlyOnceWith({ uid: limited.uid, quality: '128k' })
})

it('取消和 Escape 不触发下载，再次打开按当前播放偏好预选', async () => {
  await act(async () => root.render(<SongRow track={track} />))
  await click(container.querySelector('[aria-label="下载"]')!)
  await click(radio('flac'))
  await click(button('取消'))
  expect(container.querySelector('dialog')).toBeNull()
  await click(container.querySelector('[aria-label="下载"]')!)
  expect(radio('320k').checked).toBe(true)
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(container.querySelector('dialog')).toBeNull()
  expect(download).not.toHaveBeenCalled()
})

it('缺少音质信息时提示可尝试下载，保留四档选择', async () => {
  const unknown = { ...track, musicInfo: { ...track.musicInfo, types: [] } }
  await act(async () => root.render(<SongRow track={unknown} />))
  await click(container.querySelector('[aria-label="下载"]')!)
  expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(4)
  expect(container.textContent).toContain('暂无音质信息')
  expect(radio('320k').checked).toBe(true)
  await click(button('开始下载'))
  expect(download).toHaveBeenCalledExactlyOnceWith({ uid: unknown.uid, quality: '320k' })
})
