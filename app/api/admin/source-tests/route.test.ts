import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createDraft: vi.fn(), recentDrafts: vi.fn(), startSourceTest: vi.fn(), prepareTest: vi.fn(), commitDraft: vi.fn(), getDraft: vi.fn(), cancelTest: vi.fn(), discardDraft: vi.fn(), after: vi.fn() }))
vi.mock('@/lib/services/user-context', () => ({ requireAdmin: mocks.requireAdmin, AuthError: class extends Error {}, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/services/source-test-service', () => ({ ...mocks, SourceTestError: class extends Error { constructor(message: string, public status = 400) { super(message) } } }))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }))
const { GET, POST } = await import('./route')
const detail = await import('./[id]/route')
const upload = await import('../sources/upload/route')
const subscription = await import('../sources/subscriptions/route')
const context = { params: Promise.resolve({ id: 'draft-id' }) }
const request = (body: unknown, headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/admin/source-tests', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockResolvedValue({ id: 7 }); mocks.createDraft.mockResolvedValue({ id: 'candidate', status: 'ready' }) })

describe('音源候选路由', () => {
  it('打开已有音源窗口只请求预览，开始时才创建任务', async () => {
    await POST(request({ sourcePath: 'custom-sources/source.js', preview: true }))
    expect(mocks.createDraft).toHaveBeenCalledWith(7, { sourcePath: 'custom-sources/source.js', update: false, preview: true })
    expect(mocks.startSourceTest).not.toHaveBeenCalled()
    const run = vi.fn()
    mocks.startSourceTest.mockResolvedValue({ id: 'started-id', run })
    mocks.getDraft.mockResolvedValue({ id: 'started-id', status: 'running' })
    const response = await POST(request({ action: 'run', sourcePath: 'custom-sources/source.js', hash: 'a'.repeat(64), mode: 'quick' }))
    expect(response.status).toBe(202)
    expect(mocks.startSourceTest).toHaveBeenCalledWith(7, 'custom-sources/source.js', 'a'.repeat(64), 'quick', undefined)
    expect(mocks.after).toHaveBeenCalledWith(run)
    expect(run).not.toHaveBeenCalled()
  })
  it('分别返回已启动的记录和待处理候选', async () => {
    mocks.recentDrafts.mockImplementation(async (_owner: number, kind?: string) => kind === 'pending' ? [{ id: 'pending' }] : [{ id: 'tested' }])
    const response = await GET(new NextRequest('http://localhost/api/admin/source-tests'))
    expect((await response.json()).data).toEqual({ list: [{ id: 'tested' }], pending: [{ id: 'pending' }] })
  })
  it('缺少有效快照或检测模式时拒绝创建任务', async () => {
    for (const body of [{ hash: '', mode: 'quick' }, { hash: 'a'.repeat(64), mode: 'invalid' }]) {
      expect((await POST(request({ action: 'run', sourcePath: 'custom-sources/source.js', ...body }))).status).toBe(400)
    }
    expect(mocks.startSourceTest).not.toHaveBeenCalled()
  })
  it('订阅下载只创建候选，返回草稿而不是启用音源', async () => {
    const response = await subscription.POST(request({ url: 'https://example.com/source.js' }))
    expect(response.status).toBe(201)
    expect(mocks.createDraft).toHaveBeenCalledWith(7, { url: 'https://example.com/source.js' })
    expect((await response.json()).data).toEqual({ id: 'candidate', status: 'ready' })
  })
  it('上传只创建归属于当前管理员的候选', async () => {
    const form = new FormData(); form.append('file', new File(['// fixture'], 'source.js'))
    const response = await upload.POST(new NextRequest('http://localhost/api/admin/sources/upload', { method: 'POST', body: form }))
    expect(response.status).toBe(201)
    expect(mocks.createDraft).toHaveBeenCalledWith(7, { file: { name: 'source.js', content: '// fixture' } })
  })
  it('拒绝跨站创建候选', async () => {
    const response = await POST(request({ sourcePath: 'custom-sources/a.js' }, { origin: 'https://evil.example' }))
    expect(response.status).toBe(403); expect(mocks.createDraft).not.toHaveBeenCalled()
  })
  it('未授权请求不会执行测试或读取脚本', async () => {
    const { AuthError } = await import('@/lib/services/user-context')
    mocks.requireAdmin.mockRejectedValue(new AuthError())
    const response = await detail.POST(request({ action: 'run', mode: 'quick' }), context)
    expect(response.status).toBe(401); expect(mocks.prepareTest).not.toHaveBeenCalled()
  })
  it('测试在返回响应后执行，API 返回持久化任务状态', async () => {
    const run = vi.fn(); mocks.prepareTest.mockResolvedValue(run); mocks.getDraft.mockResolvedValue({ status: 'running' })
    const response = await detail.POST(request({ action: 'run', mode: 'full', keys: ['kw:flac'] }), context)
    expect(response.status).toBe(202)
    expect(mocks.prepareTest).toHaveBeenCalledWith('draft-id', 7, 'full', ['kw:flac'])
    expect(mocks.after).toHaveBeenCalledWith(run); expect(run).not.toHaveBeenCalled()
  })
})
