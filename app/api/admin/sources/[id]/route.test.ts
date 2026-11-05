import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), updateSource: vi.fn(), getSourceScript: vi.fn(), createDraft: vi.fn() }))
vi.mock('@/lib/services/user-context', () => ({ requireAdmin: mocks.requireAdmin, AuthError: class extends Error {}, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/services/source-manager-service', () => ({ ...mocks, SourceConfigError: class extends Error { constructor(message: string, public statusCode = 400) { super(message) } } }))
vi.mock('@/lib/services/source-test-service', () => ({ createDraft: mocks.createDraft, SourceTestError: class extends Error {} }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
const { PUT } = await import('./route')
const { GET } = await import('./script/route')
const { AuthError, ForbiddenError } = await import('@/lib/services/user-context')
const context = { params: Promise.resolve({ id: 'custom-sources/音源%20.js' }) }
const request = (body: unknown = {}, headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/admin/sources/source', {
  method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers },
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAdmin.mockResolvedValue({ id: 7 })
  mocks.updateSource.mockResolvedValue({ path: 'custom-sources/音源%20.js' })
  mocks.getSourceScript.mockResolvedValue({ content: Buffer.from('\ufeff// installed\r\n'), filename: '音源%20.js' })
})

describe('音源地址编辑与脚本下载路由', () => {
  it.each([['未登录', AuthError, 401], ['非管理员', ForbiddenError, 403]] as const)('%s 不能编辑地址或下载脚本', async (_label, ErrorType, status) => {
    mocks.requireAdmin.mockRejectedValue(new ErrorType())
    expect((await PUT(request({ subscriptionUrl: 'https://example.com/new.js' }), context)).status).toBe(status)
    expect((await GET(request(), context)).status).toBe(status)
    expect(mocks.updateSource).not.toHaveBeenCalled()
    expect(mocks.getSourceScript).not.toHaveBeenCalled()
  })
  it('地址编辑透传 URL，拒绝错误类型及跨站操作', async () => {
    expect((await PUT(request({ subscriptionUrl: 123 }), context)).status).toBe(400)
    expect((await PUT(request({ subscriptionUrl: 'https://example.com/new.js' }, { origin: 'https://evil.example' }), context)).status).toBe(403)
    expect(mocks.updateSource).not.toHaveBeenCalled()
    expect((await PUT(request({ subscriptionUrl: 'https://example.com/new.js' }), context)).status).toBe(200)
    expect(mocks.updateSource).toHaveBeenCalledWith('custom-sources/音源%20.js', expect.objectContaining({ subscriptionUrl: 'https://example.com/new.js' }))
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })
  it('下载保留原始字节，使用附件响应并禁止缓存，不执行订阅更新', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('\ufeff// installed\r\n'))
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('音源%20.js'))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(mocks.getSourceScript).toHaveBeenCalledWith('custom-sources/音源%20.js')
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })
  it('不存在的音源或脚本返回 404', async () => {
    mocks.getSourceScript.mockRejectedValue(new Error('找不到音源脚本文件'))
    expect((await GET(request(), context)).status).toBe(404)
  })
})
