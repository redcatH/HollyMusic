import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FavoritesPage } from '../src/routes/FavoritesPage'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import type { FavoriteSong } from '@/lib/api/favorites'

const api = vi.hoisted(() => ({ listFavorites: vi.fn(), starSong: vi.fn(), unstarSong: vi.fn() }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/favorites', () => api)
vi.mock('@/lib/toast', () => ({ toast: { error: toastError } }))
vi.mock('@/components/shared/SongList', () => ({ SongList: ({ tracks }: { tracks: { uid: string }[] }) => <div>{tracks.map(t => t.uid).join(',')}</div> }))
vi.mock('@/components/shared/LoadingSkeleton', () => ({ LoadingSkeleton: () => <div>loading</div> }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => <div>empty</div> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const favorites = (start: number, count: number): FavoriteSong[] => Array.from({ length: count }, (_, i) => ({
  songId: `kw-song${start + i}`, source: 'kw', starredAt: '2026-09-21T00:00:00Z',
  musicInfo: {
    source: 'kw', songmid: `song${start + i}`, name: `song${start + i}`, singer: 'tester', interval: '03:00',
    types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {},
  },
}))
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  api.listFavorites.mockResolvedValue({ list: [], total: 0 })
  useFavoritesStore.getState().reset()
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  useFavoritesStore.getState().reset()
  vi.unstubAllGlobals()
})
async function mount() {
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 200 })
  await act(async () => { root.render(<FavoritesPage />) })
}
async function loadMore() {
  const button = container.querySelector('button')!
  expect(button.textContent).toContain('加载更多')
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

it('收藏刷新完成后丢弃此前发出的加载更多响应', async () => {
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  await loadMore()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 100 })
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  await act(async () => { pending.resolve({ list: favorites(100, 100), total: 200 }) })
  expect(container.textContent).not.toContain('kw-song100')
  expect(container.textContent).not.toContain('加载更多')
})

it('过期加载更多的失败不弹提示，也不结束新分页的 loading', async () => {
  await mount()
  const oldPage = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(oldPage.promise)
  await loadMore()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 200 })
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  const newPage = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(newPage.promise)
  await loadMore()
  await act(async () => { oldPage.reject(new Error('stale response')) })
  expect(toastError).not.toHaveBeenCalled()
  expect(container.querySelector('button')?.disabled).toBe(true)
  await act(async () => { newPage.resolve({ list: favorites(100, 100), total: 200 }) })
  expect(container.textContent).toContain('kw-song199')
})

it('页面卸载后不处理旧分页错误', async () => {
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  await loadMore()
  await act(async () => { root.render(null) })
  await act(async () => { pending.reject(new Error('unmounted response')) })
  expect(toastError).not.toHaveBeenCalled()
})

it('连续点击只发送一个分页请求', async () => {
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  const button = container.querySelector('button')!
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(api.listFavorites).toHaveBeenCalledTimes(2)
  await act(async () => { pending.resolve({ list: favorites(100, 100), total: 200 }) })
})

it('超过 500 首的已加载深度在收藏刷新后仍保留', async () => {
  const all = favorites(0, 700)
  api.listFavorites.mockImplementation(async (limit: number, offset: number) => ({
    list: all.slice(offset, offset + limit), total: all.length,
  }))
  await act(async () => { root.render(<FavoritesPage />) })
  for (let i = 0; i < 5; i++) await loadMore()
  expect(container.textContent).toContain('600/700')
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 500)
  expect(container.textContent).toContain('kw-song599')
  expect(container.textContent).toContain('600/700')
})

it('分页仍按原始条目偏移推进，避免去重后反复读取重叠页面', async () => {
  await mount()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(99, 100), total: 300 })
  await loadMore()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(200, 100), total: 300 })
  await loadMore()
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 200)
  expect(container.textContent).not.toContain('加载更多')
})
