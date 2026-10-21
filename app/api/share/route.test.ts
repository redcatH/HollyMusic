import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_SITE_SETTINGS, PROJECT_URL } from '@/lib/site-settings'

const { read, song } = vi.hoisted(() => ({ read: vi.fn(), song: vi.fn() }))
vi.mock('@/lib/services/site-settings', () => ({ getSiteSettings: read }))
vi.mock('@/lib/db', () => ({ resolveMusicInfoById: song }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }))
const { GET } = await import('./route')
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(DEFAULT_SITE_SETTINGS); song.mockResolvedValue(null) })

it('分享页名称与元数据安全转义，固定保留开源署名', async () => {
  read.mockResolvedValue({ name: '"><script>alert(1)</script>&', description: '站点 "简介"' })
  const response = await GET(new NextRequest('https://music.test/api/share'))
  const html = await response.text()
  expect(html).toContain('og:site_name" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;"')
  expect(html).toContain('打开 &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;')
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain(`href="${PROJECT_URL}"`)
  expect(html).toContain('Powered by Holly Music')
  expect(response.headers.get('cache-control')).toBe('no-cache')
})
it('歌曲分享保留歌曲标题、播放地址与站点名称', async () => {
  read.mockResolvedValue({ name: '我的站点', description: '' })
  song.mockResolvedValue({ name: '歌曲', singer: '歌手', source: 'kw', types: [{ type: '128k' }] })
  const html = await (await GET(new NextRequest('https://music.test/api/share?uid=kw-1'))).text()
  expect(html).toContain('<title>歌曲 - 歌手 · 我的站点</title>')
  expect(html).toContain('/api/audio?uid=kw-1&amp;quality=128k')
  expect(html).toContain('og:site_name" content="我的站点"')
})
it('设置读取失败时分享仍可打开，使用默认品牌', async () => {
  read.mockRejectedValue(new Error('db failure'))
  const html = await (await GET(new NextRequest('https://music.test/api/share'))).text()
  expect(html).toContain('<title>Holly Music</title>')
})
