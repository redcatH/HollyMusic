import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SearchPage } from '../src/routes/SearchPage'
import { useSearchStore } from '@/lib/store/search-store'
import { search } from '@/lib/api/search'

vi.mock('@/lib/api/search', () => ({ search: vi.fn(async () => ({ list: [] })) }))
vi.mock('@/components/shared/SongList', () => ({ SongList: () => null }))

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
  expect(search).toHaveBeenCalledExactlyOnceWith('kw', '周杰伦', 1, 30)
})

it('切换音源更新 URL，浏览器后退恢复前一次搜索', async () => {
  await render('/search?q=hello&source=kw')
  const button = [...container.querySelectorAll('[role="tab"]')].find(node => node.textContent === 'QQ')!
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(new URLSearchParams(currentSearch).get('source')).toBe('tx')
  expect(search).toHaveBeenLastCalledWith('tx', 'hello', 1, 30)
  await act(async () => { await navigate(-1) })
  expect(useSearchStore.getState()).toMatchObject({ keyword: 'hello', source: 'kw' })
  expect(search).toHaveBeenLastCalledWith('kw', 'hello', 1, 30)
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
