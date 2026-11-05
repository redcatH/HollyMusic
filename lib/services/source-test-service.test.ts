import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import type { MusicInfo } from '@/lib/types/music'

const mocks = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), samples: vi.fn(), publicRequest: vi.fn(), commit: vi.fn(), readConfig: vi.fn(), readScript: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { sourceTestDraft: {
  count: vi.fn(async () => 0),
  findFirst: vi.fn(async ({ where }: { where: { id: string; ownerId: number } }) => { const row = mocks.rows.get(where.id); return row?.ownerId === where.ownerId ? row : null }),
  findMany: vi.fn(async ({ where, cursor, skip = 0, take }: { where: { ownerId: number; expiresAt: { gt: Date } }; cursor?: { id: string }; skip?: number; take: number }) => {
    const rows = [...mocks.rows.values()].filter(row => row.ownerId === where.ownerId && (row.expiresAt as Date) > where.expiresAt.gt)
      .sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime() || String(b.id).localeCompare(String(a.id)))
    const start = cursor ? rows.findIndex(row => row.id === cursor.id) + skip : 0
    return rows.slice(start, start + take)
  }),
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { mocks.rows.set(data.id as string, { ...data, createdAt: new Date(), updatedAt: new Date() }); return data }),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = { ...mocks.rows.get(where.id), ...data, updatedAt: new Date() }; mocks.rows.set(where.id, row); return row }),
  deleteMany: vi.fn(async () => ({ count: 0 })),
  delete: vi.fn(async ({ where }: { where: { id: string } }) => mocks.rows.delete(where.id)),
} } }))
vi.mock('@/lib/services/system-settings', () => ({ getSystemSetting: mocks.samples }))
vi.mock('@/lib/server/source-script-file', () => ({ readSourceScriptFile: mocks.readScript }))
vi.mock('@/lib/source-testing/network.cjs', () => ({ publicRequest: mocks.publicRequest }))
vi.mock('@/lib/server/source-test-runner', () => ({ runSourceTestJob: mocks.run }))
vi.mock('@/lib/services/source-manager-service', () => ({ readConfig: mocks.readConfig, commitTestedSource: mocks.commit, SOURCE_MANAGER_CONSTANTS: { MAX_SCRIPT_SIZE: 5242880 } }))
const service = await import('./source-test-service')
const { prisma } = await import('@/lib/db')
const song = { source: 'kw', songmid: '1', name: 'VIP 样本', singer: '歌手', interval: '04:00', _types: { flac: {}, '320k': {} }, types: [], typeUrl: {} } as unknown as MusicInfo
const fixture = '// trusted script fixture'
const digest = createHash('sha256').update(fixture).digest('hex')
const facts = { codec: 'FLAC', duration: 240, sampleRate: 44100, bitsPerSample: 16, bitrate: 800000, channels: 2, lossless: true }
const calls: Array<Record<string, unknown>> = []
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.clear(); calls.length = 0
  mocks.samples.mockResolvedValue({ kw: song }); mocks.readConfig.mockResolvedValue({ sources: [] })
  mocks.readScript.mockResolvedValue(fixture)
  mocks.publicRequest.mockResolvedValue({ status: 200, headers: {}, data: Buffer.from(fixture), complete: true })
  mocks.commit.mockImplementation(async (input: { id: string; pt: string[]; enabled: boolean }) => ({ path: 'custom-sources/confirmed.js', importId: input.id, pt: input.pt, enabled: input.enabled, priority: 1 }))
  mocks.run.mockImplementation(async (job: Record<string, unknown>) => {
    calls.push(job)
    return job.action === 'inspect' ? { name: '测试源', info: { sources: { kw: { qualitys: ['flac', '320k'], actions: ['musicUrl'] } } } } : job.action === 'resolve' ? { url: 'https://public.example/audio' } : facts
  })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(async () => {
  for (const [id, row] of mocks.rows) await service.discardDraft(id, row.ownerId as number).catch(() => {})
  vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

describe('候选到测试再提交的完整服务流程', () => {
  it('反复打开已有音源的测试预览不保存草稿、不占配额，也不产生测试记录', async () => {
    mocks.readConfig.mockResolvedValue({ sources: [{ path: 'custom-sources/fixture.js', name: '已有音源', enabled: true, priority: 1 }] })
    for (let i = 0; i < 3; i++) {
      expect(await service.createDraft(7, { sourcePath: 'custom-sources/fixture.js', preview: true })).toMatchObject({ persisted: false, kind: 'retest', results: [] })
    }
    expect(prisma.sourceTestDraft.create).not.toHaveBeenCalled()
    expect(prisma.sourceTestDraft.count).not.toHaveBeenCalled()
    expect(prisma.sourceTestDraft.deleteMany).not.toHaveBeenCalled()
    expect(await service.recentDrafts(7)).toEqual([])
    expect(await service.recentDrafts(7, 'pending')).toEqual([])
    expect(calls.map(call => call.action)).toEqual(['inspect', 'inspect', 'inspect'])
  })
  it('显式开始测试后才保存已有音源的测试记录，并使用同一脚本摘要', async () => {
    mocks.readConfig.mockResolvedValue({ sources: [{ path: 'custom-sources/fixture.js', enabled: true, priority: 1 }] })
    const preview = await service.createDraft(7, { sourcePath: 'custom-sources/fixture.js', preview: true })
    const started = await service.startSourceTest(7, preview.target!.path, preview.hash, 'quick')
    try {
      const reports = await service.recentDrafts(7)
      expect(reports).toMatchObject([{ id: started.id, status: 'running', startedAt: expect.any(String) }])
      expect(reports[0].results).toHaveLength(2)
      expect(mocks.rows.has(preview.id)).toBe(false)
    } finally { await started.run() }
    expect((await service.getDraft(started.id, 7)).status).toBe('completed')
  })
  it('开始前脚本发生变化或缺少测试歌曲时不留下空记录', async () => {
    mocks.readConfig.mockResolvedValue({ sources: [{ path: 'custom-sources/fixture.js', enabled: true, priority: 1 }] })
    await expect(service.startSourceTest(7, 'custom-sources/fixture.js', '0'.repeat(64), 'quick')).rejects.toMatchObject({ status: 409 })
    expect(mocks.run).not.toHaveBeenCalled()
    mocks.samples.mockResolvedValue({})
    await expect(service.startSourceTest(7, 'custom-sources/fixture.js', digest, 'quick')).rejects.toThrow('没有可测试')
    expect(mocks.rows.size).toBe(0)
    expect(await service.recentDrafts(7)).toEqual([])
  })
  it('旧的空测试草稿不挤掉实际报告，未测试的上传和订阅候选仍可恢复', async () => {
    const draft = await service.createDraft(7, { file: { name: 'source.js', content: fixture } })
    await (await service.prepareTest(draft.id, 7, 'quick'))()
    const pending = await service.createDraft(7, { url: 'https://public.example/source.js' })
    const row = mocks.rows.get(pending.id)!
    for (let i = 0; i < 65; i++) {
      const id = randomUUID()
      mocks.rows.set(id, { ...row, id, updatedAt: new Date(Date.now() + i + 1000), stateJson: JSON.stringify({ ...pending, id, kind: 'retest' }) })
    }
    const otherId = randomUUID()
    mocks.rows.set(otherId, { ...row, id: otherId, ownerId: 8, stateJson: JSON.stringify({ ...pending, id: otherId }) })
    expect((await service.recentDrafts(7)).map(report => report.id)).toEqual([draft.id])
    expect((await service.recentDrafts(7, 'pending')).map(report => report.id)).toEqual([pending.id])
    expect(prisma.sourceTestDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, stateJson: true }, cursor: { id: expect.any(String) }, skip: 1 }))
  })
  it('即使正式播放器是 inline，上传仍使用独立测试进程且确认前不注册', async () => {
    vi.stubEnv('SOURCE_RUNNER_MODE', 'inline')
    const draft = await service.createDraft(7, { file: { name: 'source.js', content: fixture } })
    expect(draft).toMatchObject({ hash: digest, status: 'ready', capabilities: { kw: ['flac', '320k'] } })
    expect(calls.map(call => call.action)).toEqual(['inspect'])
    expect(mocks.commit).not.toHaveBeenCalled()
  })
  it('订阅仅下载一次，测试和提交使用相同摘要及快照', async () => {
    const draft = await service.createDraft(7, { url: 'https://public.example/source.js' })
    const run = await service.prepareTest(draft.id, 7, 'quick'); await run()
    const report = await service.getDraft(draft.id, 7)
    expect(report.results).toHaveLength(2)
    expect(report.results.every(result => result.status === 'passed')).toBe(true)
    expect(mocks.publicRequest).toHaveBeenCalledWith('https://public.example/audio', expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String), Referer: 'https://public.example' }) }))
    expect(calls.filter(call => call.action === 'resolve').map(call => call.quality)).toEqual(['flac', '320k'])
    const count = mocks.publicRequest.mock.calls.length
    await service.commitDraft(draft.id, 7, { enabled: true, pt: ['kw'] })
    expect(mocks.publicRequest).toHaveBeenCalledTimes(count)
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({ content: fixture, subscriptionUrl: 'https://public.example/source.js' }))
    expect((await service.getDraft(draft.id, 7)).status).toBe('committed')
    await service.commitDraft(draft.id, 7, { enabled: true, pt: ['kw'] })
    expect(mocks.commit).toHaveBeenCalledOnce()
  })
  it('某档音质失败不会借用下一档的成功结果', async () => {
    const normal = mocks.run.getMockImplementation()!
    mocks.run.mockImplementation(async (job: Record<string, unknown>) => {
      if (job.action === 'resolve' && job.quality === 'flac') throw new Error('该音质不可用')
      return normal(job)
    })
    const draft = await service.createDraft(7, { file: { name: 'source.js', content: fixture } })
    await (await service.prepareTest(draft.id, 7, 'quick'))()
    expect((await service.getDraft(draft.id, 7)).results.map(result => [result.quality, result.status])).toEqual([['flac', 'failed'], ['320k', 'passed']])
  })
  it('取消会中断实际请求，未执行项也标记为停止', async () => {
    const draft = await service.createDraft(7, { file: { name: 'source.js', content: fixture } })
    mocks.run.mockImplementation((_job: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'))
      else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const run = await service.prepareTest(draft.id, 7, 'quick')
    const running = run()
    await service.cancelTest(draft.id, 7)
    await running
    const report = await service.getDraft(draft.id, 7)
    expect(report.status).toBe('cancelled')
    expect(report.results.every(result => result.status === 'cancelled')).toBe(true)
  })
  it('同一候选不能重复启动，歌曲缺失不计为音源失败', async () => {
    const draft = await service.createDraft(7, { file: { name: 'source.js', content: fixture } })
    mocks.samples.mockResolvedValue({})
    await expect(service.prepareTest(draft.id, 7, 'quick')).rejects.toThrow('没有可测试')
    expect((await service.getDraft(draft.id, 7)).status).toBe('ready')
    mocks.samples.mockResolvedValue({ kw: song })
    const run = await service.prepareTest(draft.id, 7, 'quick')
    await expect(service.prepareTest(draft.id, 7, 'quick')).rejects.toMatchObject({ status: 409 })
    await service.cancelTest(draft.id, 7); await run()
  })
  it('无需额外测试服务配置，直接创建本地候选', async () => {
    const draft = await service.createDraft(7, { file: { name: 'source.js', content: fixture } })
    expect(draft.status).toBe('ready')
    expect(mocks.run).toHaveBeenCalledWith({ action: 'inspect', content: fixture }, undefined)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['upload', 'subscription'])('真实本地进程完成 %s 的初始化、取链、音频分析及确认导入', async kind => {
    const { runSourceTestJob } = await vi.importActual<typeof import('@/lib/server/source-test-runner')>('@/lib/server/source-test-runner')
    mocks.run.mockImplementation(runSourceTestJob)
    const content = `const {on,send,EVENT_NAMES}=lx; on(EVENT_NAMES.request,()=> 'https://public.example/audio'); send(EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['320k']}}})`
    const wav = Buffer.alloc(16044)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)
    mocks.publicRequest.mockImplementation(async (url: string) => ({ status: 200, headers: {}, data: url.endsWith('.js') ? Buffer.from(content) : wav, complete: true }))
    mocks.samples.mockResolvedValue({ kw: { ...song, interval: '00:01', _types: { '320k': {} } } })
    const draft = await service.createDraft(7, kind === 'upload' ? { file: { name: 'fixture.js', content } } : { url: 'https://public.example/fixture.js' })
    await (await service.prepareTest(draft.id, 7, 'full'))()
    const report = await service.getDraft(draft.id, 7)
    expect(report.results).toMatchObject([{ status: 'passed', complete: true, facts: { duration: 1, sampleRate: 8000, bitsPerSample: 16 } }])
    await service.commitDraft(draft.id, 7, { pt: ['kw'], enabled: true })
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({ content, enabled: true, pt: ['kw'] }))
    expect(fetchMock).not.toHaveBeenCalled()
  }, 15000)
})
