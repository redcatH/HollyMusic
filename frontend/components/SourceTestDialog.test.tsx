import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceTestDialog, TestSongSettings } from '@/components/admin/SourceTestDialog'
import type { SourceTestDraft } from '@/lib/source-testing/types'
import type { Song } from '@/lib/types/music'

const api = vi.hoisted(() => ({ loadTestSamples: vi.fn(), saveTestSamples: vi.fn(), runSourceTest: vi.fn(), getSourceTest: vi.fn(), cancelSourceTest: vi.fn(), commitSourceTest: vi.fn(), discardSourceTest: vi.fn(), listSourceTests: vi.fn() }))
vi.mock('@/lib/api/source-tests', () => api)
const search = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/search', () => ({ search }))
const song = { uid: 'kw-1', source: 'kw', songmid: '1', name: '测试歌曲', singer: '歌手', interval: '04:00', types: [], _types: { flac: {} }, typeUrl: {} } as unknown as Song
const draft: SourceTestDraft = { id: 'id', name: '测试源', kind: 'upload', hash: 'hash', capabilities: { kw: ['flac'], tx: ['320k'] }, status: 'ready', results: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
let container: HTMLDivElement, root: Root
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api.loadTestSamples.mockResolvedValue({ kw: song }); api.saveTestSamples.mockImplementation(async value => value)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe('音源测试交互', () => {
  it('未测试时不能导入并启用，可以显式保存为停用', async () => {
    const close = vi.fn(), committed = vi.fn().mockResolvedValue(undefined)
    api.commitSourceTest.mockResolvedValue({})
    await act(async () => root.render(<SourceTestDialog initialDraft={draft} onClose={close} onCommitted={committed} />))
    expect(button('导入并启用').disabled).toBe(true)
    await act(async () => button('仅保存为停用').click())
    expect(api.commitSourceTest).toHaveBeenCalledWith('id', [], false)
    expect(committed).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
  })
  it('报告通过也不自动修改选择，用户勾选后才提交平台', async () => {
    const completed = { ...draft, status: 'completed', results: [{ key: 'kw:flac', platform: 'kw', quality: 'flac', song, mode: 'quick', status: 'passed', message: '通过' }] } as SourceTestDraft
    api.commitSourceTest.mockResolvedValue({})
    await act(async () => root.render(<SourceTestDialog initialDraft={completed} onClose={vi.fn()} onCommitted={vi.fn()} />))
    expect(button('导入并启用').disabled).toBe(true)
    await act(async () => button('勾选通过的平台').click())
    expect(button('导入并启用').disabled).toBe(false)
    await act(async () => button('导入并启用').click())
    expect(api.commitSourceTest).toHaveBeenCalledWith('id', ['kw'], true)
  })
  it('后台继续仅关闭弹窗，不取消测试', async () => {
    const close = vi.fn()
    await act(async () => root.render(<SourceTestDialog initialDraft={{ ...draft, status: 'running' }} onClose={close} onCommitted={vi.fn()} />))
    await act(async () => button('后台继续').click())
    expect(close).toHaveBeenCalledOnce(); expect(api.cancelSourceTest).not.toHaveBeenCalled()
  })
  it('本地测试失败在当前窗口展示，允许继续操作', async () => {
    api.runSourceTest.mockRejectedValue(new Error('本地测试执行失败'))
    await act(async () => root.render(<SourceTestDialog initialDraft={draft} onClose={vi.fn()} onCommitted={vi.fn()} />))
    await act(async () => button('开始测试').click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('本地测试执行失败')
    expect(button('开始测试').disabled).toBe(false)
  })
  it('平台内搜索选歌后保存，保留其他平台的配置', async () => {
    search.mockResolvedValue({ list: [{ ...song, uid: 'tx-2', source: 'tx', songmid: '2' }] })
    await act(async () => root.render(<TestSongSettings />))
    const txRow = [...container.querySelectorAll('.border-border')].find(item => item.textContent?.startsWith('腾讯'))!
    await act(async () => txRow.querySelector<HTMLButtonElement>('button')!.click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索测试歌曲"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '歌手')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('搜索').click())
    await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent?.includes('选用'))!.click())
    expect(api.saveTestSamples).toHaveBeenCalledWith(expect.objectContaining({ kw: song, tx: expect.objectContaining({ songmid: '2' }) }))
  })
})
