import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'

const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }))
vi.mock('@/lib/api/site-settings', () => ({ fetchSiteSettings: fetchSettings }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }))
beforeEach(() => { vi.resetModules(); fetchSettings.mockReset(); localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })
const store = async () => (await import('@/lib/store/site-settings-store')).useSiteSettingsStore

it('无缓存、损坏缓存默认 Holly Music；离线保留最近成功的设置', async () => {
  localStorage.setItem('holly.site-settings.v1', '{invalid')
  const settings = await store()
  expect(settings.getState().settings).toEqual(DEFAULT_SITE_SETTINGS)
  fetchSettings.mockResolvedValueOnce({ name: '我的站点', description: '' })
  await settings.getState().refresh()
  fetchSettings.mockRejectedValueOnce(new Error('offline'))
  await settings.getState().refresh()
  expect(settings.getState().settings).toEqual({ name: '我的站点', description: '' })
  vi.resetModules()
  expect((await store()).getState().settings).toEqual({ name: '我的站点', description: '' })
})
it('去重读取，管理员保存后迟到的旧响应不能覆盖新值', async () => {
  let resolve!: (settings: typeof DEFAULT_SITE_SETTINGS) => void
  fetchSettings.mockImplementation(() => new Promise(done => { resolve = done }))
  const settings = await store()
  const first = settings.getState().refresh()
  const second = settings.getState().refresh()
  expect(first).toBe(second)
  settings.getState().apply({ name: '刚保存的站点', description: '新简介' })
  resolve(DEFAULT_SITE_SETTINGS)
  await first
  expect(settings.getState().settings.name).toBe('刚保存的站点')
  expect(fetchSettings).toHaveBeenCalledOnce()
})
it('缓存禁用或配额不足不影响生效，外部无效数据不能写入', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const settings = await store()
  expect(settings.getState().settings).toEqual(DEFAULT_SITE_SETTINGS)
  settings.getState().apply({ name: '有效站点', description: '' })
  expect(settings.getState().settings.name).toBe('有效站点')
  expect(() => settings.getState().apply({ name: '', description: '' })).toThrow()
  expect(settings.getState().settings.name).toBe('有效站点')
})
