import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from '@/lib/site-settings'

const { admin, read, update } = vi.hoisted(() => ({ admin: vi.fn(), read: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/services/user-context', async original => ({
  ...await original<typeof import('@/lib/services/user-context')>(), requireAdmin: admin,
}))
vi.mock('@/lib/services/site-settings', () => ({ getSiteSettings: read, updateSiteSettings: update }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
const { GET, PUT } = await import('./route')
const { AuthError, ForbiddenError } = await import('@/lib/services/user-context')

function request(body = JSON.stringify(DEFAULT_SITE_SETTINGS), headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:5173/api/admin/site-settings', {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...headers }, body,
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  admin.mockResolvedValue({ username: 'admin' })
  read.mockResolvedValue(DEFAULT_SITE_SETTINGS)
  update.mockImplementation(async value => parseSiteSettings(value))
})

it.each([['匿名', new AuthError(), 401], ['普通用户', new ForbiddenError(), 403]] as const)('%s 不能读取或修改', async (_, error, status) => {
  admin.mockRejectedValue(error)
  expect((await GET(request())).status).toBe(status)
  expect((await PUT(request())).status).toBe(status)
  expect(read).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
})
it('管理员读取与保存规范化文本，不缓存管理响应', async () => {
  const readResponse = await GET(request())
  expect(await readResponse.json()).toEqual({ success: true, data: DEFAULT_SITE_SETTINGS })
  expect(readResponse.headers.get('cache-control')).toBe('no-store')
  const response = await PUT(request(JSON.stringify({ name: ' 新站点 ', description: '' })))
  expect(await response.json()).toEqual({ success: true, data: { name: '新站点', description: '' } })
  expect(response.headers.get('cache-control')).toBe('no-store')
})
it.each([
  ['{', {}, 400], ['null', {}, 400], ['{"name":" ","description":""}', {}, 400],
  ['{}', { origin: 'https://evil.test' }, 403], ['{}', { origin: 'null' }, 403],
  ['{}', { 'sec-fetch-site': 'cross-site' }, 403], ['{}', { 'content-type': 'text/plain' }, 415],
  ['x'.repeat(4100), {}, 413], ['{}', { 'content-length': '4100' }, 413],
] as Array<[string, Record<string, string>, number]>)('拒绝非法写入 %s %j', async (body, headers, status) => {
  expect((await PUT(request(body, headers))).status).toBe(status)
})
it('HTTPS 反代保留 Host 时允许同源保存，数据库故障返回可重试错误', async () => {
  expect((await PUT(request(undefined, { origin: 'https://music.test', host: 'music.test' }))).status).toBe(200)
  update.mockRejectedValueOnce(new Error('db failure'))
  expect((await PUT(request())).status).toBe(503)
  read.mockRejectedValueOnce(new Error('db failure'))
  expect((await GET(request())).status).toBe(503)
})
