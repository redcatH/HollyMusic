import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/lib/generated/prisma'

const database = vi.hoisted(() => ({ client: null as PrismaClient | null }))
vi.mock('@/lib/generated/prisma', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/generated/prisma')>()
  return { ...actual, PrismaClient: class { constructor() { return database.client! } } }
})
vi.mock('@/lib/services/user-context', () => ({
  requireUser: vi.fn(async () => ({ username: 'alice' })),
  AuthError: class extends Error {},
}))

let directory: string
let remove: typeof import('./route')['DELETE']
let clear: typeof import('../route')['DELETE']
let ownId: number
let otherId: number

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'holly-history-delete-'))
  const databasePath = path.join(directory, 'test.db')
  await writeFile(databasePath, '')
  const url = `file:${databasePath.replaceAll(path.sep, '/')}`
  await promisify(execFile)(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma',
  ], { env: { ...process.env, DATABASE_URL: url } })
  const actual = await vi.importActual<typeof import('@/lib/generated/prisma')>('@/lib/generated/prisma')
  database.client = new actual.PrismaClient({ datasourceUrl: url })
  remove = (await import('./route')).DELETE
  clear = (await import('../route')).DELETE
}, 30000)

afterAll(async () => {
  await database.client?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  vi.clearAllMocks()
  await database.client!.playHistory.deleteMany()
  ownId = (await database.client!.playHistory.create({ data: { username: 'alice', songmid: 'kw-1' } })).id
  otherId = (await database.client!.playHistory.create({ data: { username: 'bob', songmid: 'kw-1' } })).id
  await database.client!.playHistory.create({ data: { username: 'alice', songmid: 'kw-2' } })
})

function request(id: string) {
  return remove(new NextRequest(`http://localhost/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })
}

it('仅删除指定记录，保留本人的其他记录和其他用户的同一首歌记录；重复删除幂等', async () => {
  const response = await request(String(ownId))
  expect(response.status).toBe(200)
  expect((await response.json()).data).toEqual({ deleted: 1 })
  expect(await database.client!.playHistory.findUnique({ where: { id: ownId } })).toBeNull()
  expect(await database.client!.playHistory.count()).toBe(2)
  expect((await (await request(String(ownId))).json()).data).toEqual({ deleted: 0 })
})

it('不能删除其他用户的记录', async () => {
  expect((await (await request(String(otherId))).json()).data).toEqual({ deleted: 0 })
  expect(await database.client!.playHistory.count()).toBe(3)
})

it.each(['0', '-1', '1.5', 'abc', '1foo', '1e2', '9007199254740992'])('无效 ID %s 返回 400，保留全部历史', async id => {
  expect((await request(id)).status).toBe(400)
  expect(await database.client!.playHistory.count()).toBe(3)
})

it('未登录不能删除', async () => {
  const { requireUser, AuthError } = await import('@/lib/services/user-context')
  vi.mocked(requireUser).mockRejectedValueOnce(new AuthError('未登录'))
  expect((await request(String(ownId))).status).toBe(401)
  expect(await database.client!.playHistory.count()).toBe(3)
})

it('原清空接口仍只清空当前用户历史', async () => {
  const response = await clear(new NextRequest('http://localhost/api/history', { method: 'DELETE' }))
  expect((await response.json()).data).toEqual({ deleted: 2 })
  expect(await database.client!.playHistory.count()).toBe(1)
  expect(await database.client!.playHistory.findUnique({ where: { id: otherId } })).not.toBeNull()
})
