import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createDraft: vi.fn(), recentDrafts: vi.fn(), prepareTest: vi.fn(), commitDraft: vi.fn(), getDraft: vi.fn(), cancelTest: vi.fn(), discardDraft: vi.fn(), after: vi.fn() }))
vi.mock('@/lib/services/user-context', () => ({ requireAdmin: mocks.requireAdmin, AuthError: class extends Error {}, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/services/source-test-service', () => ({ ...mocks, SourceTestError: class extends Error { constructor(message: string, public status = 400) { super(message) } } }))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }))
const { POST } = await import('./route')
const detail = await import('./[id]/route')
const upload = await import('../sources/upload/route')
const subscription = await import('../sources/subscriptions/route')
const context = { params: Promise.resolve({ id: 'draft-id' }) }
const request = (body: unknown, headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/admin/source-tests', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockResolvedValue({ id: 7 }); mocks.createDraft.mockResolvedValue({ id: 'candidate', status: 'ready' }) })

describe('音源候选路由', () => {
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
