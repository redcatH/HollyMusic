import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SiteSettingsPanel } from '@/components/admin/SiteSettingsPanel'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'
import { useSiteSettingsStore } from '@/lib/store/site-settings-store'
import { SiteMetadata } from '../src/components/SiteMetadata'
import { AuthLayout } from '../src/components/AuthLayout'
import { MobileHeader } from '../src/components/MobileHeader'

const { read, save, publicRead } = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), publicRead: vi.fn() }))
vi.mock('@/lib/api/site-settings', () => ({ fetchAdminSiteSettings: read, saveSiteSettings: save, fetchSiteSettings: publicRead }))
vi.mock('../src/components/AppearanceSettings', () => ({ AppearanceButton: () => null }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  useSiteSettingsStore.setState({ settings: { ...DEFAULT_SITE_SETTINGS } })
  read.mockResolvedValue(DEFAULT_SITE_SETTINGS)
  publicRead.mockResolvedValue(DEFAULT_SITE_SETTINGS)
  save.mockImplementation(async value => value)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => root.render(<SiteSettingsPanel />)) }
async function fill(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }

it('草稿预览安全展示文本，保存成功才修改全局品牌与离线缓存', async () => {
  await render()
  await fill('site-name', '<img src=x onerror=alert(1)>')
  await fill('site-description', '')
  expect(container.querySelector('[aria-label="站点预览"]')?.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(container.querySelector('img')).toBeNull()
  expect(useSiteSettingsStore.getState().settings).toEqual(DEFAULT_SITE_SETTINGS)
  await submit()
  expect(save).toHaveBeenCalledWith({ name: '<img src=x onerror=alert(1)>', description: '' })
  expect(useSiteSettingsStore.getState().settings.description).toBe('')
  expect(container.querySelector('[role="status"]')?.textContent).toContain('已保存')
})
it('恢复默认只更新草稿，必须保存才会影响所有用户', async () => {
  read.mockResolvedValueOnce({ name: '自定义站点', description: '自定义简介' })
  await render()
  const reset = [...container.querySelectorAll('button')].find(button => button.textContent === '恢复默认值')!
  await act(async () => reset.click())
  expect(container.querySelector<HTMLInputElement>('#site-name')?.value).toBe('Holly Music')
  expect(useSiteSettingsStore.getState().settings.name).toBe('自定义站点')
  expect(save).not.toHaveBeenCalled()
  await submit()
  expect(useSiteSettingsStore.getState().settings).toEqual(DEFAULT_SITE_SETTINGS)
})
it('保存失败保留草稿和原品牌，可重试；加载失败不会显示可提交的默认值', async () => {
  await render()
  await fill('site-name', '待保存站点')
  save.mockRejectedValueOnce(new Error('暂时不可用'))
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('暂时不可用')
  expect(container.querySelector<HTMLInputElement>('#site-name')?.value).toBe('待保存站点')
  expect(useSiteSettingsStore.getState().settings).toEqual(DEFAULT_SITE_SETTINGS)
  await submit()
  expect(useSiteSettingsStore.getState().settings.name).toBe('待保存站点')
  await act(async () => root.render(null))
  read.mockRejectedValueOnce(new Error('加载失败'))
  await render()
  expect(container.querySelector('form')).toBeNull()
  expect(container.textContent).toContain('重新加载')
})
it('登录、手机首页、浏览器标题与 PWA 链接统一更新，空简介不显示', async () => {
  await act(async () => root.render(<MemoryRouter><SiteMetadata /><MobileHeader onMenuClick={() => {}} /><AuthLayout title="登录" description="欢迎" footer="账号登录">表单</AuthLayout></MemoryRouter>))
  await act(async () => useSiteSettingsStore.getState().apply({ name: '我的音乐', description: '' }))
  expect(document.title).toBe('我的音乐')
  expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('我的音乐')
  expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toContain(encodeURIComponent('我的音乐'))
  expect(container.querySelector('footer p')).toBeNull()
  expect(container.querySelector('footer a')?.textContent).toBe('Powered by Holly Music')
  expect(container.querySelector('header span[title]')?.textContent).toBe('我的音乐')
  expect(container.querySelector('header .truncate')?.textContent).toBe('我的音乐')
})
