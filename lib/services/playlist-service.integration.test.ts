import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma'

// 真实 SQLite 临时库，隔离用户数据库；service 与断言共用此客户端。
const database = vi.hoisted(() => ({ client: null as PrismaClient | null }))
vi.mock('../generated/prisma', async importOriginal => {
  const actual = await importOriginal<typeof import('../generated/prisma')>()
  return {
    ...actual,
    PrismaClient: class {
      constructor() { return database.client! }
    },
  }
})

let directory: string
let service: typeof import('./playlist-service')
let playlistId: number
let entryIds: number[]

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'holly-playlist-'))
  const databasePath = path.join(directory, 'test.db')
  // 预建空文件，避免 Windows 下 Prisma 初始化不存在的 SQLite 文件时报错。
  await writeFile(databasePath, '')
  const url = `file:${databasePath.replaceAll(path.sep, '/')}`
  // 使用当前 Node 启动 JS 入口，避免依赖不同平台的 .bin 脚本。
  await promisify(execFile)(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'),
    'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate',
  ], { env: { ...process.env, DATABASE_URL: url } })
  const actual = await vi.importActual<typeof import('../generated/prisma')>('../generated/prisma')
  database.client = new actual.PrismaClient({ datasourceUrl: url })
  service = await import('./playlist-service')
}, 30000)

afterAll(async () => {
  await database.client?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  const client = database.client!
  await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_playlist_stats')
  await client.user.deleteMany()
  await client.musicInfo.deleteMany()
  await client.user.create({ data: { username: 'tester' } })
  const music = await client.musicInfo.create({ data: {
    source: 'kw', songmid: '1', data: '{}', checksum: 'test', durationSeconds: 60,
  } })
  const playlist = await client.playlist.create({ data: {
    username: 'tester', name: 'test', songCount: 3, duration: 180,
    entries: { create: [1, 2, 3].map(position => ({
      position, songmid: `kw-${position}`, musicInfoId: music.id,
    })) },
  }, include: { entries: { orderBy: { position: 'asc' } } } })
  playlistId = playlist.id
  entryIds = playlist.entries.map(entry => entry.id)
})

describe('歌单修改的 SQLite 事务', () => {
  it('统计更新失败时删除与重排全部回滚', async () => {
    await database.client!.$executeRawUnsafe(`
      CREATE TRIGGER fail_playlist_stats BEFORE UPDATE OF songCount ON Playlist
      BEGIN SELECT RAISE(ABORT, 'stats failed'); END
    `)
    await expect(service.removeSongsFromPlaylist(playlistId, 'tester', [entryIds[0]])).rejects.toThrow()
    const playlist = await database.client!.playlist.findUniqueOrThrow({
      where: { id: playlistId }, include: { entries: { orderBy: { position: 'asc' } } },
    })
    expect(playlist.entries.map(entry => [entry.id, entry.position])).toEqual(
      entryIds.map((id, index) => [id, index + 1])
    )
    expect([playlist.songCount, playlist.duration]).toEqual([3, 180])
  })

  it('并发删除不同条目后，保留歌曲、重排和统计一致', async () => {
    await Promise.all([
      service.removeSongsFromPlaylist(playlistId, 'tester', [entryIds[0]]),
      service.removeSongsFromPlaylist(playlistId, 'tester', [entryIds[1]]),
    ])
    const playlist = await database.client!.playlist.findUniqueOrThrow({
      where: { id: playlistId }, include: { entries: true },
    })
    expect(playlist.entries.map(entry => [entry.id, entry.position])).toEqual([[entryIds[2], 1]])
    expect([playlist.songCount, playlist.duration]).toEqual([1, 60])
    await expect(service.removeSongsFromPlaylist(playlistId, 'tester', [entryIds[0]]))
      .rejects.toMatchObject({ statusCode: 404 })
    expect(await database.client!.playlistEntry.count({ where: { playlistId } })).toBe(1)
  })

  it('并发添加与删除后，数量和时长对应最终条目', async () => {
    await Promise.all([
      service.removeSongsFromPlaylist(playlistId, 'tester', [entryIds[0]]),
      service.addSongsToPlaylist(playlistId, 'tester', ['kw-4']),
    ])
    const playlist = await database.client!.playlist.findUniqueOrThrow({
      where: { id: playlistId }, include: { entries: { orderBy: { position: 'asc' } } },
    })
    expect(playlist.entries.map(entry => entry.songmid)).toEqual(['kw-2', 'kw-3', 'kw-4'])
    expect(playlist.entries.map(entry => entry.position)).toEqual([1, 2, 3])
    expect([playlist.songCount, playlist.duration]).toEqual([3, 120])
  })
})
