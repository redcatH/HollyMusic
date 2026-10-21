import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'
import baseManifest from '@/public/manifest.json'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/services/site-settings', () => ({ getSiteSettings: read }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
const { GET } = await import('./route')
const { GET: manifest } = await import('../manifest/route')

beforeEach(() => { read.mockReset(); read.mockResolvedValue(DEFAULT_SITE_SETTINGS) })

it('无需认证读取公开品牌，不缓存过期名称', async () => {
  const response = await GET()
  expect(await response.json()).toEqual({ success: true, data: DEFAULT_SITE_SETTINGS })
  expect(response.headers.get('cache-control')).toBe('no-store')
})
it('默认清单保留应用标识、图标和启动地址，自定义后名称与简介同步', async () => {
  const response = await manifest()
  expect(response.headers.get('content-type')).toContain('application/manifest+json')
  expect(response.headers.get('cache-control')).toBe('no-cache')
  expect(await response.json()).toEqual(baseManifest)
  read.mockResolvedValueOnce({ name: '我的音乐', description: '' })
  expect(await (await manifest()).json()).toEqual({ ...baseManifest, name: '我的音乐', short_name: '我的音乐', description: '' })
})
it('数据库不可用时不以成功响应覆盖客户端的最近配置', async () => {
  read.mockRejectedValue(new Error('db failure'))
  expect((await GET()).status).toBe(503)
  expect((await manifest()).status).toBe(503)
})
