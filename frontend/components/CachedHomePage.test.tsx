import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CachedHomePage } from '../src/components/CachedHomePage'
import { DiscoveryCollectionPage } from '../src/routes/DiscoveryCollectionPage'
import { getRecommendedPlaylists, getToplists } from '@/lib/api/discovery'

vi.mock('@/lib/api/discovery', () => ({
  getRecommendedPlaylistDetail: vi.fn(async () => ({ id: 'list', name: '详情', tracks: [] })),
  getToplistDetail: vi.fn(async () => ({ id: '0', name: '榜单详情', tracks: [] })),
  getToplists: vi.fn(async () => Array.from({ length: 6 }, (_, index) => ({
    id: String(index), name: `榜单 ${index}`, description: '', cover: '', source: 'tx',
  }))),
  getRecommendedPlaylists: vi.fn(async () => [{
    id: 'list', name: '缓存的歌单', author: '歌手', description: '', cover: '', playCount: 1, source: 'tx',
  }]),
}))

let root: Root
let container: HTMLDivElement
let navigate: ReturnType<typeof useNavigate>
let currentUrl: string
function TestPage({ account = 'alice' }: { account?: string }) {
  const routerNavigate = useNavigate()
  const location = useLocation()
  useLayoutEffect(() => {
    navigate = routerNavigate
    currentUrl = location.pathname + location.search
  }, [routerNavigate, location])
  return <>
    <CachedHomePage key={account} />
    <Routes>
      <Route path="/discover/playlists/:id" element={<DiscoveryCollectionPage kind="playlists" />} />
      <Route path="/discover/toplists/:id" element={<DiscoveryCollectionPage kind="toplists" />} />
      <Route path="*" element={null} />
    </Routes>
  </>
}
async function render(route = '/', account = 'alice') {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[route]}><TestPage account={account} /></MemoryRouter>)
  })
}
function home() { return container.querySelector('main')! }
async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.clearAllMocks()
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('从详情返回保留首页 DOM、展开状态与滚动位置，不重复请求数据', async () => {
  await render('/?source=kw&page=2')
  const node = home()
  const expand = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('全部榜单'))!
  await click(expand)
  node.scrollTop = 680
  await act(async () => { node.dispatchEvent(new Event('scroll', { bubbles: true })) })
  await act(async () => { await navigate('/discover/playlists/list?source=tx') })
  expect(home()).toBe(node)
  expect(node.hidden).toBe(true)
  // 模拟浏览器隐藏滚动容器后重置布局位置。
  node.scrollTop = 0
  await act(async () => { await navigate(-1) })
  expect(node.hidden).toBe(false)
  expect(node.scrollTop).toBe(680)
  expect(node.textContent).toContain('榜单 5')
  expect(node.querySelector('[aria-selected="true"]')?.textContent).toBe('酷我音乐')
  expect(getToplists).toHaveBeenCalledExactlyOnceWith('kw')
  expect(getRecommendedPlaylists).toHaveBeenCalledTimes(1)
})

it('未访问首页时不预加载，首次访问才请求，普通导航返回不重复加载且手动刷新有效', async () => {
  await render('/search')
  expect(home()).toBeNull()
  expect(getToplists).not.toHaveBeenCalled()
  await act(async () => { await navigate('/') })
  await act(async () => { await navigate('/history') })
  await act(async () => { await navigate('/') })
  expect(getToplists).toHaveBeenCalledTimes(1)
  await click(container.querySelector('[aria-label="刷新"]')!)
  expect(getToplists).toHaveBeenCalledTimes(2)
  expect(getRecommendedPlaylists).toHaveBeenCalledTimes(2)
})

it('首页隐藏后不会因未完成的搜索防抖修改当前页面地址', async () => {
  await render()
  const input = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '音乐')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(input.value).toBe('音乐')
  await act(async () => { await navigate('/search?source=wy') })
  await act(async () => { vi.advanceTimersByTime(500) })
  expect(currentUrl).toBe('/search?source=wy')
  expect(getToplists).toHaveBeenCalledTimes(1)
  expect(getRecommendedPlaylists).toHaveBeenCalledTimes(1)
})

it('首页查询参数变化时正常加载新内容，账号变化会清除旧页面与位置', async () => {
  await render()
  const oldNode = home()
  await act(async () => { await navigate('/?source=wy') })
  expect(getToplists).toHaveBeenLastCalledWith('wy')
  await render('/', 'bob')
  expect(home()).not.toBe(oldNode)
  expect(home().scrollTop).toBe(0)
  expect(getToplists).toHaveBeenCalledTimes(3)
})

it('QQ 歌单提供推荐选项，切换后重置页码并可恢复原有排序', async () => {
  await render('/?source=tx&sort=hot&page=4')
  const select = container.querySelector<HTMLSelectElement>('[aria-label="歌单排序"]')!
  expect([...select.options].map(option => option.textContent)).toEqual(['推荐', '最热', '最新'])
  await act(async () => {
    select.value = 'recommend'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(new URLSearchParams(currentUrl.split('?')[1]).get('page')).toBe('1')
  expect(getRecommendedPlaylists).toHaveBeenLastCalledWith('tx', 12, 1, expect.objectContaining({ sort: 'recommend' }))
  await act(async () => { await navigate('/?source=tx&sort=new&page=2') })
  expect(select.value).toBe('new')
  expect(getRecommendedPlaylists).toHaveBeenLastCalledWith('tx', 12, 2, expect.objectContaining({ sort: 'new' }))
})

it.each(['playlists/list', 'toplists/0'])('从搜索结果进入 %s 后点击发现音乐，保留搜索、筛选、页码及滚动位置', async detail => {
  const url = '/?source=kw&keyword=音乐&category=2189-10000&sort=new&page=2'
  await render(url)
  const originalUrl = currentUrl
  const node = home()
  node.scrollTop = 420
  await act(async () => { node.dispatchEvent(new Event('scroll', { bubbles: true })) })
  await click(node.querySelector(`a[href="/discover/${detail}?source=kw"]`)!)
  const backLink = [...container.querySelectorAll('a')].find(link => link.textContent?.trim() === '发现音乐')!
  expect(backLink.getAttribute('href')).toBe(originalUrl)
  await click(backLink)
  await act(async () => { vi.advanceTimersByTime(500) })
  expect(currentUrl).toBe(originalUrl)
  expect(node.querySelector('input')?.value).toBe('音乐')
  expect(node.scrollTop).toBe(420)
  expect(getRecommendedPlaylists).toHaveBeenCalledTimes(1)
})

it('直接打开详情时返回当前渠道的首页', async () => {
  await render('/discover/playlists/list?source=wy')
  const backLink = [...container.querySelectorAll('a')].find(link => link.textContent?.trim() === '发现音乐')!
  expect(backLink.getAttribute('href')).toBe('/?source=wy')
  await click(backLink)
  expect(getToplists).toHaveBeenCalledExactlyOnceWith('wy')
})
