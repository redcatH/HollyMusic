import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/lib/generated/prisma'
import type { PluginImportResult } from '@/lib/platform-plugin-admin'

const database = vi.hoisted(() => ({ client: null as PrismaClient | null }))
vi.mock('@/lib/generated/prisma', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/generated/prisma')>(),
  PrismaClient: class { constructor() { return database.client! } },
}))
vi.mock('@/lib/services/user-context', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/services/user-context')>(),
  requireAdmin: async () => ({ id: 1, username: 'admin' }),
}))

let directory: string
let admin: typeof import('./platform-plugin-service')
let catalog: typeof import('./platform-catalog')
let search: typeof import('./search-service')

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'holly-platform-plugin-'))
  const dbPath = path.join(directory, 'test.db')
  await writeFile(dbPath, '')
  const url = `file:${dbPath.replaceAll(path.sep, '/')}`
  await promisify(execFile)(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url } })
  const actual = await vi.importActual<typeof import('@/lib/generated/prisma')>('@/lib/generated/prisma')
  database.client = new actual.PrismaClient({ datasourceUrl: url })
  admin = await import('./platform-plugin-service')
  catalog = await import('./platform-catalog')
  search = await import('./search-service')
}, 30000)

afterAll(async () => {
  await database.client?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

const packageSource = (version: string, title: string) => `
function searchSongs({ cursor }, { platform }) {
  if (typeof process !== 'undefined' || typeof require !== 'undefined') throw new Error('unexpected globals')
  return { items: [{ id: cursor === '2' ? '702' : '701', name: '${title} ' + platform, artist: '歌手' }],
    hasMore: cursor !== '2', nextCursor: cursor === '2' ? undefined : '2' }
}
holly.register({apiVersion:1,id:'combined-fixture',name:'测试包',version:'${version}',platforms:[
  { id:'qs',name:'汽水音乐',origins:[],handlers:{searchSongs} },
  { id:'tx',name:'QQ 音乐',origins:[],handlers:{searchSongs} },
]});`

it('上传接口直接启用多平台功能，换版后拒绝旧游标并支持回滚', async () => {
  const { POST } = await import('@/app/api/admin/platform-plugins/route')
  const response = await POST(new NextRequest('http://localhost/api/admin/platform-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'text/javascript' },
    body: packageSource('1.0.0', '原版'),
  }))
  expect(response.status).toBe(201)
  const { revision: first, activeCount, conflicts }: PluginImportResult = (await response.json()).data
  expect(activeCount).toBe(2)
  expect(conflicts).toEqual([])
  expect(first.tests).toEqual({})
  expect(first.manifest.platforms.map(item => item.id)).toEqual(['qs', 'tx'])
  expect(await catalog.getPluginBinding('tx', 'searchSongs')).toBe(first.id)
  const firstPage = await search.searchSongs('qs', '样本', 1, 30)
  const { uid, ...previousInfo } = firstPage.list[0]
  expect(uid).toBe('qs-701')
  expect(previousInfo).toMatchObject({ types: [], name: '原版 qs' })
  const nextPage = await search.searchSongs('qs', '样本', 2, 30, firstPage.nextCursor)
  expect(nextPage.list[0].uid).toBe('qs-702')
  expect(nextPage.nextPage).toBeNull()
  expect(await database.client!.musicInfo.count({ where: { source: 'qs' } })).toBe(2)
  const flac = { type: 'flac' as const, size: '25 MB' }
  await catalog.persistPluginSongs([{ ...previousInfo, types: [flac], _types: { flac } }])
  const cachedPage = await search.searchSongs('qs', '样本', 1, 30)
  expect(cachedPage.list[0]).toMatchObject({ uid: 'qs-701', types: [flac], _types: { flac } })
  expect((await search.searchSongs('qs', '样本', 2, 30, firstPage.nextCursor)).list[0].types).toEqual([])
  const upgraded = await admin.uploadPlatformPlugin(packageSource('1.1.0', '新版'), 1)
  expect(upgraded.activeCount).toBe(2)
  expect(await catalog.getPluginBinding('tx', 'searchSongs')).toBe(upgraded.revision.id)
  expect((await search.searchSongs('qs', '样本', 1, 30)).list[0]).toMatchObject({ name: '新版 qs', types: [flac] })
  await expect(search.searchSongs('qs', '样本', 2, 30, firstPage.nextCursor)).rejects.toThrow('内容已变更')

  const beforeRetry = await database.client!.platformPluginChange.count()
  expect(await admin.uploadPlatformPlugin(packageSource('1.1.0', '新版'), 1)).toEqual(upgraded)
  expect(await database.client!.platformPluginChange.count()).toBe(beforeRetry)
  const change = await database.client!.platformPluginChange.findFirstOrThrow({
    where: { requestJson: JSON.stringify({ importRevisionId: upgraded.revision.id }) },
  })
  const rollback = { requestId: 'rollback', rollbackId: change.id }
  const reverted = await admin.changePluginBindings(rollback, 1)
  expect(await admin.changePluginBindings(rollback, 1)).toEqual(reverted)
  expect(await catalog.getPluginBinding('tx', 'searchSongs')).toBe(first.id)
  expect((await search.searchSongs('qs', '样本', 1, 30)).list[0].name).toBe('原版 qs')
}, 30000)

it('离线 demo 插件覆盖导入、按需测试和多项目录能力', async () => {
  const { runPlatformJob } = createRequire(import.meta.url)('../source-testing/platform-plugin.cjs')
  const content = await readFile('examples/platform-plugins/demo-catalog.js', 'utf8')
  const { revision, activeCount, conflicts } = await admin.uploadPlatformPlugin(content, 1)
  expect(revision.manifest.platforms[0]).toMatchObject({ id: 'demo', capabilities: expect.arrayContaining(['getPlaylist', 'searchSongs']) })
  expect(revision.tests).toEqual({})
  expect(conflicts).toEqual([])
  expect(activeCount).toBe(revision.manifest.platforms[0].capabilities.length)
  expect(await admin.testPlatformPlugin({ revisionId: revision.id, platform: 'demo', capability: 'searchSongs', sample: '示例' })).toMatchObject({
    ok: true, count: 2, sampleId: 'demo-song-1',
  })
  expect(await admin.testPlatformPlugin({ revisionId: revision.id, platform: 'demo', capability: 'listPlaylistCategories' })).toMatchObject({ ok: true, count: 2 })

  const result = await runPlatformJob({
    action: 'platformCall', content, platform: 'demo', capability: 'getPlaylist', input: { id: 'demo-playlist-1', limit: 12 },
  }, () => { throw new Error('离线 demo 不应发起网络请求') })
  expect(result).toMatchObject({ collection: { id: 'demo-playlist-1', cover: 'https://example.com/demo-playlist.webp' } })
  expect(result.items).toHaveLength(2)
})

it('可以删除单个版本或整个插件，并保留其他包和安全的变更记录', async () => {
  const { POST } = await import('@/app/api/admin/platform-plugins/route')
  const content = (version: string) => `holly.register({
    apiVersion: 1, id: 'deletion-fixture', name: '删除测试包', version: '${version}',
    platforms: [{ id: 'qa', name: '测试平台', origins: [], handlers: {
      listPlaylists() {}, listPlaylistCategories() {}, searchSongs() {}
    } }]
  })`
  const { revision: first } = await admin.uploadPlatformPlugin(content('1.0.0'), 1)
  const { revision: second } = await admin.uploadPlatformPlugin(content('1.1.0'), 1)
  const { revision: separate } = await admin.uploadPlatformPlugin(`holly.register({
    apiVersion: 1, id: 'separate-fixture', name: '另一个包', version: '1.0.0',
    platforms: [{ id: 'qa', name: '测试平台', origins: [], handlers: { getPlaylist() {} } }]
  })`, 1)
  const switchChange = await database.client!.platformPluginChange.findFirstOrThrow({
    where: { requestJson: JSON.stringify({ importRevisionId: second.id }) },
  })

  async function deleteThroughApi(revisionId: string, scope: 'revision' | 'package', expected: number) {
    const response = await POST(new NextRequest('http://localhost/api/admin/platform-plugins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', revisionId, scope }),
    }))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ deleted: expected })
  }

  await deleteThroughApi(first.id, 'revision', 1)
  await deleteThroughApi(first.id, 'revision', 0)
  expect(await catalog.getPluginBinding('qa', 'searchSongs')).toBe(second.id)
  await expect(admin.changePluginBindings({ requestId: 'deleted-rollback', rollbackId: switchChange.id }, 1))
    .rejects.toThrow('回滚所需的插件版本已删除')
  const { revision: third } = await admin.uploadPlatformPlugin(content('1.2.0'), 1)
  await deleteThroughApi(third.id, 'package', 2)
  expect(await database.client!.platformPluginRevision.count({ where: { packageId: 'deletion-fixture' } })).toBe(0)
  expect(await catalog.getPluginBinding('qa', 'searchSongs')).toBeNull()
  expect(await catalog.getPluginBinding('qa', 'listPlaylists')).toBeNull()
  expect(await catalog.getPluginBinding('qa', 'listPlaylistCategories')).toBeNull()
  expect(await catalog.getPluginBinding('qa', 'getPlaylist')).toBe(separate.id)

  const deletions = (await admin.getPluginAdminView()).changes.filter(item => item.deletion?.name === '删除测试包')
  expect(deletions.map(item => item.deletion)).toEqual([
    { name: '删除测试包', revisionCount: 2 },
    { name: '删除测试包', revisionCount: 1, version: '1.0.0' },
  ])
  expect(deletions[0].changes).toHaveLength(3)
  await expect(admin.changePluginBindings({ requestId: 'undo-deletion', rollbackId: deletions[0].id }, 1))
    .rejects.toThrow('删除记录无法回滚')
}, 15000)
