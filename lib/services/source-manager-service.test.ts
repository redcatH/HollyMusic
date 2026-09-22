import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import type { MusicSourcesConfig } from '@/lib/types/music'

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
  reload: vi.fn(),
}))

vi.mock('fs/promises', () => ({ default: mocks }))
vi.mock('@/lib/music-source-manager', () => ({ musicSourceManager: { reload: mocks.reload } }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '93.184.216.34' }]) } }))

const service = await import('./source-manager-service')
const configPath = service.SOURCE_MANAGER_CONSTANTS.CONFIG_PATH
const readStoredConfig = (): MusicSourcesConfig => JSON.parse(mocks.files.get(configPath)!)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.files.clear()
  mocks.files.set(configPath, JSON.stringify({ sources: [
    { path: 'custom-sources/a.js', enabled: true, priority: 1, pt: ['kw', 'tx'] },
    { path: 'custom-sources/b.js', enabled: true, priority: 2, pt: ['wy'] },
  ] }))
  mocks.readFile.mockImplementation(async (file: string) => {
    if (!mocks.files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return mocks.files.get(file)
  })
  mocks.writeFile.mockImplementation(async (file: string, content: string) => { mocks.files.set(file, content) })
  mocks.rename.mockImplementation(async (from: string, to: string) => {
    const content = mocks.files.get(from)
    if (content === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    mocks.files.set(to, content)
    mocks.files.delete(from)
  })
  mocks.unlink.mockImplementation(async (file: string) => { mocks.files.delete(file) })
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.reload.mockResolvedValue(undefined)
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('音源配置批量保存', () => {
  it('批量保存与单条编辑并发时，保留两次更新', async () => {
    await Promise.all([
      service.updateSourcesBulk([{ path: 'custom-sources/a.js', enabled: false }]),
      service.updateSource('custom-sources/b.js', { priority: 7 }),
    ])
    expect(readStoredConfig().sources).toEqual([
      expect.objectContaining({ path: 'custom-sources/a.js', enabled: false }),
      expect.objectContaining({ path: 'custom-sources/b.js', priority: 7 }),
    ])
  })

  it('批量保存与删除并发时，不复活已删除音源或丢失启停更新', async () => {
    await Promise.all([
      service.updateSourcesBulk([{ path: 'custom-sources/a.js', enabled: false }]),
      service.removeSource('custom-sources/b.js'),
    ])
    expect(readStoredConfig().sources).toEqual([
      expect.objectContaining({ path: 'custom-sources/a.js', enabled: false }),
    ])
  })

  it('包含已删除音源时整批拒绝，不返回部分成功', async () => {
    await expect(service.updateSourcesBulk([
      { path: 'custom-sources/a.js', enabled: false },
      { path: 'custom-sources/missing.js', enabled: false },
    ])).rejects.toMatchObject({ statusCode: 409 })
    expect(readStoredConfig().sources[0].enabled).toBe(true)
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('拒绝未知平台，避免过滤为空后意外恢复全部平台', async () => {
    await expect(service.updateSourcesBulk([
      { path: 'custom-sources/a.js', pt: ['unknown'] },
    ])).rejects.toMatchObject({ statusCode: 400 })
    expect(readStoredConfig().sources[0].pt).toEqual(['kw', 'tx'])
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('重复路径整批拒绝', async () => {
    await expect(service.updateSourcesBulk([
      { path: 'custom-sources/a.js', enabled: false },
      { path: 'custom-sources/a.js', enabled: true },
    ])).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('平台集合相同或仅顺序不同，不写配置也不重建播放实例', async () => {
    expect(await service.updateSourcesBulk([
      { path: 'custom-sources/a.js', pt: ['tx', 'kw', 'kw'] },
    ])).toEqual({ updated: 0 })
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('真正变更多条配置时只写一次并重载一次', async () => {
    expect(await service.updateSourcesBulk([
      { path: 'custom-sources/a.js', enabled: false },
      { path: 'custom-sources/b.js', priority: 1, pt: ['kw'] },
    ])).toEqual({ updated: 2 })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('原子替换失败保留旧配置，后续保存仍可执行', async () => {
    mocks.rename.mockRejectedValueOnce(new Error('rename failed'))
    await expect(service.updateSourcesBulk([
      { path: 'custom-sources/a.js', enabled: false },
    ])).rejects.toThrow('rename failed')
    expect(readStoredConfig().sources[0].enabled).toBe(true)
    await service.updateSourcesBulk([{ path: 'custom-sources/b.js', enabled: false }])
    expect(readStoredConfig().sources[1].enabled).toBe(false)
  })

  it('读取缺失配置不落盘，避免列表查询覆盖首次保存', async () => {
    mocks.files.delete(configPath)
    expect(await service.readConfig()).toEqual({ sources: [] })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('订阅更新保留下载期间修改的筛选、启停和其它音源', async () => {
    const config = readStoredConfig()
    config.sources[0].subscription = { url: 'https://example.com/source.js', updatedAt: '2026-01-01' }
    mocks.files.set(configPath, JSON.stringify(config))
    // CommonJS 音源运行器通过 require 加载；替换入口，避免执行脚本或启动子进程。
    const runnerModule = createRequire(import.meta.url)('../music-core/runner-client.js')
    vi.spyOn(runnerModule, 'getSourceRunner').mockReturnValue({
      mode: 'process',
      validateScript: vi.fn(async () => ({ ok: true, sourceInfo: { sources: { kw: {}, tx: {}, wy: {} } } })),
    })
    let finishDownload!: (response: Response) => void
    let downloadStarted!: () => void
    const started = new Promise<void>(resolve => { downloadStarted = resolve })
    vi.stubGlobal('fetch', vi.fn(() => {
      downloadStarted()
      return new Promise<Response>(resolve => { finishDownload = resolve })
    }))

    const subscription = service.updateSubscribedSource('custom-sources/a.js')
    await started
    await service.updateSourcesBulk([{ path: 'custom-sources/a.js', enabled: false, pt: ['tx'] }])
    await service.addSource({ path: 'custom-sources/c.js' })
    finishDownload(new Response('// isolated test fixture'))
    await subscription

    expect(readStoredConfig().sources).toHaveLength(3)
    expect(readStoredConfig().sources[0]).toMatchObject({ enabled: false, pt: ['tx'] })
  })
})
