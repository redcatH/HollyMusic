import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SearchPage } from '../src/routes/SearchPage'
import { useSearchStore } from '@/lib/store/search-store'
import { search, type SearchResultData } from '@/lib/api/search'
import type { Song } from '@/lib/types/music'

vi.mock('@/lib/api/search', () => ({ search: vi.fn(async () => ({ list: [] })) }))
vi.mock('@/components/shared/SongList', () => ({ SongList: ({ tracks }: { tracks: { uid: string }[] }) => <div data-testid="songs">{tracks.map(t => t.uid).join(',')}</div> }))

let root: Root
let container: HTMLDivElement
let navigate: ReturnType<typeof useNavigate>
let currentSearch = ''

function TestPage() {
  navigate = useNavigate()
  currentSearch = useLocation().search
  return <SearchPage />
}
async function render(url = '/search') {
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={[url]}><TestPage /></MemoryRouter></StrictMode>)
  })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useSearchStore.getState().reset()
  vi.clearAllMocks()
  vi.mocked(search).mockReset().mockResolvedValue({ list: [], hasMore: false, nextPage: null, limit: 30 } as unknown as SearchResultData)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  vi.unstubAllGlobals()
})

it('刷新从 URL 恢复搜索词与音源并重新请求，StrictMode 不重复请求', async () => {
  await render('/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6&source=kw')
  expect(container.querySelector('input')?.value).toBe('周杰伦')
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('酷我')
  expect(search).toHaveBeenCalledExactlyOnceWith('kw', '周杰伦', 1, 30, expect.any(AbortSignal))
})

it('切换音源更新 URL，浏览器后退恢复前一次搜索', async () => {
  await render('/search?q=hello&source=kw')
  const button = [...container.querySelectorAll('[role="tab"]')].find(node => node.textContent === 'QQ')!
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(new URLSearchParams(currentSearch).get('source')).toBe('tx')
  expect(search).toHaveBeenLastCalledWith('tx', 'hello', 1, 30, expect.any(AbortSignal))
  await act(async () => { await navigate(-1) })
  expect(useSearchStore.getState()).toMatchObject({ keyword: 'hello', source: 'kw' })
  expect(search).toHaveBeenLastCalledWith('kw', 'hello', 1, 30, expect.any(AbortSignal))
})

it('清空后刷新或前进后退不会复活旧搜索结果', async () => {
  await render('/search?q=hello&source=kw')
  await act(async () => { container.querySelector('[aria-label="清空搜索词"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(new URLSearchParams(currentSearch).get('q')).toBe('')
  expect(useSearchStore.getState()).toMatchObject({ keyword: '', lastKeyword: '', results: [] })
  await act(async () => { await navigate(-1) })
  expect(useSearchStore.getState().keyword).toBe('hello')
  await act(async () => { await navigate(1) })
  expect(useSearchStore.getState().keyword).toBe('')
})

it('非法音源回退全部渠道', async () => {
  await render('/search?q=hello&source=invalid')
  expect(useSearchStore.getState().source).toBe('all')
  expect(search).toHaveBeenCalledTimes(5)
})

it('从站内返回搜索页保留已有结果，并补齐刷新所需参数', async () => {
  useSearchStore.setState({ keyword: 'hello', lastKeyword: 'hello', source: 'kw', lastSource: 'kw' })
  await render()
  expect(new URLSearchParams(currentSearch).get('q')).toBe('hello')
  expect(new URLSearchParams(currentSearch).get('source')).toBe('kw')
  expect(search).not.toHaveBeenCalled()
})

function result(source: 'kw' | 'wy', page: number, nextPage: number | null): SearchResultData {
  return { list: [{ uid: `${source}-${page}`, songmid: String(page), source, name: '歌曲' } as Song], source,
    total: 2, allPage: 2, page, limit: 30, hasMore: nextPage !== null, nextPage }
}

it('指定平台可追加第二页，加载失败保留首批歌曲并提供重试', async () => {
  vi.mocked(search).mockResolvedValueOnce(result('kw', 1, 2)).mockRejectedValueOnce(new Error('请求超时')).mockResolvedValueOnce(result('kw', 2, null))
  await render('/search?q=hello&source=kw')
  const click = async (label: string) => act(async () => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === label)!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await click('加载更多')
  expect(container.querySelector('[data-testid="songs"]')?.textContent).toBe('kw-1')
  expect(container.textContent).toContain('请求超时')
  await click('重试加载')
  expect(container.querySelector('[data-testid="songs"]')?.textContent).toBe('kw-1,kw-2')
  expect(container.textContent).toContain('已加载全部可获取结果')
  expect(container.textContent).not.toContain('加载更多')
})

it('聚合模式说明仅首批，失败平台可重试，始终没有加载更多', async () => {
  vi.mocked(search).mockImplementation(async source => {
    if (source === 'wy') throw new Error('请求超时')
    return { ...result('kw', 1, 2), source, list: [{ uid: `${source}-1`, source } as Song] }
  })
  await render('/search?q=hello&source=all')
  expect(container.textContent).toContain('查看更多请切换平台')
  expect(container.textContent).not.toContain('加载更多')
  expect(container.textContent).not.toContain('已加载全部可获取结果')
  vi.mocked(search).mockResolvedValueOnce(result('wy', 1, 2))
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === '重试网易')!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(search).toHaveBeenCalledTimes(6)
  expect(container.textContent).not.toContain('网易加载失败')
  expect(container.textContent).not.toContain('加载更多')
})
