import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceTestDialog, SourceTestHistory, TestSongSettings } from '@/components/admin/SourceTestDialog'
import type { SourceTestDraft } from '@/lib/source-testing/types'
import type { Song } from '@/lib/types/music'

const api = vi.hoisted(() => ({ loadTestSamples: vi.fn(), saveTestSamples: vi.fn(), runSourceTest: vi.fn(), startSourceTest: vi.fn(), getSourceTest: vi.fn(), cancelSourceTest: vi.fn(), commitSourceTest: vi.fn(), discardSourceTest: vi.fn(), listSourceTests: vi.fn() }))
vi.mock('@/lib/api/source-tests', () => api)
const search = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/search', () => ({ search }))
const song = { uid: 'kw-1', source: 'kw', songmid: '1', name: '测试歌曲', singer: '歌手', interval: '04:00', types: [], _types: { flac: {} }, typeUrl: {} } as unknown as Song
const txSong = { ...song, uid: 'tx-2', source: 'tx', songmid: '2', _types: { '320k': {} } } as unknown as Song
const draft: SourceTestDraft = { id: 'id', name: '测试源', kind: 'upload', hash: 'hash', capabilities: { kw: ['flac'], tx: ['320k'] }, status: 'ready', results: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
const preview: SourceTestDraft = { ...draft, kind: 'retest', persisted: false, hash: 'a'.repeat(64), target: { path: 'custom-sources/source.js', enabled: true, priority: 1, pt: ['kw'] } }
let container: HTMLDivElement, root: Root
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!
const testPlatform = (name: string) => container.querySelector<HTMLInputElement>(`[aria-label="测试${name}平台"]`)!
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api.loadTestSamples.mockResolvedValue({ kw: song }); api.saveTestSamples.mockImplementation(async value => value)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe('音源测试交互', () => {
  it('打开并关闭已有音源的预览不创建任务，也不需要删除草稿', async () => {
    const close = vi.fn()
    await act(async () => root.render(<SourceTestDialog initialDraft={preview} onClose={close} onCommitted={vi.fn()} />))
    expect(button('放弃候选')).toBeUndefined()
    expect(button('保存并停用')).toBeUndefined()
    await act(async () => button('关闭').click())
    expect(close).toHaveBeenCalledOnce()
    expect(api.startSourceTest).not.toHaveBeenCalled()
    expect(api.runSourceTest).not.toHaveBeenCalled()
    expect(api.discardSourceTest).not.toHaveBeenCalled()
    expect(api.commitSourceTest).not.toHaveBeenCalled()
  })
  it.each([['开始测试', 'quick'], ['完整检查', 'full']] as const)('点击%s才创建记录，后续重测复用已保存的记录', async (label, mode) => {
    const completed = { ...preview, id: 'started-id', persisted: true, status: 'completed', results: [{ key: 'kw:flac', platform: 'kw', quality: 'flac', song, mode, status: 'passed', message: '通过' }] } as SourceTestDraft
    api.startSourceTest.mockResolvedValue(completed)
    api.runSourceTest.mockResolvedValue(completed)
    await act(async () => root.render(<SourceTestDialog initialDraft={preview} onClose={vi.fn()} onCommitted={vi.fn()} />))
    await act(async () => button(label).click())
    expect(api.startSourceTest).toHaveBeenCalledWith(preview.target!.path, preview.hash, mode, ['kw:flac'])
    expect(api.runSourceTest).not.toHaveBeenCalled()
    await act(async () => button('重新测试').click())
    expect(api.runSourceTest).toHaveBeenCalledWith('started-id', 'quick', ['kw:flac'])
    expect(api.startSourceTest).toHaveBeenCalledOnce()
  })
  it.each([
    ['已有音源', preview, '开始测试', 'quick'], ['已有音源', preview, '完整检查', 'full'],
    ['上传候选', draft, '开始测试', 'quick'], ['上传候选', draft, '完整检查', 'full'],
  ] as const)('%s 的%s只测试勾选平台，测试选择不影响启用平台', async (_kind, initial, label, mode) => {
    api.loadTestSamples.mockResolvedValue({ kw: song, tx: txSong })
    api.startSourceTest.mockRejectedValue(new Error('测试请求已记录'))
    api.runSourceTest.mockRejectedValue(new Error('测试请求已记录'))
    await act(async () => root.render(<SourceTestDialog initialDraft={initial} onClose={vi.fn()} onCommitted={vi.fn()} />))
    expect(testPlatform('腾讯').checked).toBe(true); expect(testPlatform('酷我').checked).toBe(true)
    const enabled = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(input => !input.hasAttribute('aria-label'))
    const originalEnabled = enabled.map(input => input.checked)
    await act(async () => testPlatform('酷我').click())
    await act(async () => button(label).click())
    if (initial.persisted === false) {
      expect(api.startSourceTest).toHaveBeenCalledWith(initial.target!.path, initial.hash, mode, ['tx:320k'])
      expect(api.runSourceTest).not.toHaveBeenCalled()
    } else {
      expect(api.runSourceTest).toHaveBeenCalledWith(initial.id, mode, ['tx:320k'])
      expect(api.startSourceTest).not.toHaveBeenCalled()
    }
    expect(enabled.map(input => input.checked)).toEqual(originalEnabled)
    expect(api.commitSourceTest).not.toHaveBeenCalled()
  })
  it('默认测试全部可测试平台，清空禁用启动，全选排除缺少歌曲或匹配音质的平台', async () => {
    const initial: SourceTestDraft = { ...draft, capabilities: { ...draft.capabilities, wy: ['flac'] } }
    api.loadTestSamples.mockResolvedValue({ kw: song, wy: { ...song, source: 'wy', _types: { '128k': {} } } })
    api.runSourceTest.mockRejectedValue(new Error('测试请求已记录'))
    await act(async () => root.render(<SourceTestDialog initialDraft={initial} onClose={vi.fn()} onCommitted={vi.fn()} />))
    expect(testPlatform('腾讯').disabled).toBe(true); expect(testPlatform('腾讯').checked).toBe(false)
    expect(testPlatform('网易').disabled).toBe(true); expect(testPlatform('网易').checked).toBe(false)
    expect(testPlatform('咪咕')).toBeNull()
    await act(async () => button('清空').click())
    expect(button('开始测试').disabled).toBe(true); expect(button('完整检查').disabled).toBe(true)
    await act(async () => button('开始测试').click())
    expect(api.runSourceTest).not.toHaveBeenCalled()
    expect(container.textContent).toContain('请选择至少一个测试平台')
    await act(async () => button('全选').click())
    expect(testPlatform('酷我').checked).toBe(true)
    await act(async () => button('开始测试').click())
    expect(api.runSourceTest).toHaveBeenCalledWith(draft.id, 'quick', ['kw:flac'])
  })
  it('全选时请求所有可测试平台的匹配音质', async () => {
    api.loadTestSamples.mockResolvedValue({ kw: song, tx: txSong })
    api.runSourceTest.mockRejectedValue(new Error('测试请求已记录'))
    await act(async () => root.render(<SourceTestDialog initialDraft={draft} onClose={vi.fn()} onCommitted={vi.fn()} />))
    await act(async () => button('开始测试').click())
    expect(api.runSourceTest).toHaveBeenCalledWith(draft.id, 'quick', ['tx:320k', 'kw:flac'])
  })
  it('重试失败项及单项完整检查受测试平台选择限制', async () => {
    const initial: SourceTestDraft = { ...draft, status: 'completed', results: [
      { key: 'kw:flac', platform: 'kw', quality: 'flac', song, mode: 'quick', status: 'failed', message: '失败' },
      { key: 'tx:320k', platform: 'tx', quality: '320k', song: txSong, mode: 'quick', status: 'failed', message: '失败' },
    ] }
    api.loadTestSamples.mockResolvedValue({ kw: song, tx: txSong })
    api.runSourceTest.mockRejectedValue(new Error('测试请求已记录'))
    await act(async () => root.render(<SourceTestDialog initialDraft={initial} onClose={vi.fn()} onCommitted={vi.fn()} />))
    await act(async () => testPlatform('酷我').click())
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
    await act(async () => button('重试失败项').click())
    expect(api.runSourceTest).toHaveBeenLastCalledWith(draft.id, 'quick', ['tx:320k'])
    await act(async () => rows[1].querySelector<HTMLButtonElement>('button')!.click())
    expect(api.runSourceTest).toHaveBeenLastCalledWith(draft.id, 'full', ['tx:320k'])
    await act(async () => testPlatform('腾讯').click())
    expect(button('重试失败项')).toBeUndefined()
  })
  it('部分测试进度仅统计本轮项目，保留历史结果并显示检测时间', async () => {
    const testedAt = '2026-11-05T02:00:00.000Z'
    const initial: SourceTestDraft = { ...draft, status: 'running', runKeys: ['tx:320k'], results: [
      { key: 'kw:flac', platform: 'kw', quality: 'flac', song, mode: 'quick', status: 'passed', message: '通过', testedAt },
      { key: 'tx:320k', platform: 'tx', quality: '320k', song: txSong, mode: 'quick', status: 'waiting', message: '等待测试' },
    ] }
    await act(async () => root.render(<SourceTestDialog initialDraft={initial} onClose={vi.fn()} onCommitted={vi.fn()} />))
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('已完成 0/1 项')
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('历史结果')
    expect(rows[0].textContent).toContain(new Date(testedAt).toLocaleString())
    expect(rows[1].textContent).toContain('本次测试')
    expect(testPlatform('酷我').matches(':disabled')).toBe(true)
    expect(button('清空').matches(':disabled')).toBe(true)
  })
  it('未测试的上传候选显示待处理，可继续恢复；实际报告单独展示', async () => {
    const report = { ...draft, id: 'report', name: '已测试音源', status: 'completed', results: [{ status: 'passed' }] } as SourceTestDraft
    api.listSourceTests.mockResolvedValue({ list: [report], pending: [draft] })
    const select = vi.fn()
    await act(async () => root.render(<SourceTestHistory onClose={vi.fn()} onSelect={select} />))
    const pending = container.querySelector('[aria-label="待处理音源"]')!
    const history = container.querySelector('[aria-label="测试记录"]')!
    expect(pending.textContent).toContain('未测试 · 上传音源')
    expect(pending.textContent).not.toContain('0/0')
    expect(history.textContent).toContain('已测试音源')
    expect(history.textContent).toContain('1/1 项通过')
    await act(async () => pending.querySelector<HTMLButtonElement>('button')!.click())
    expect(select).toHaveBeenCalledWith(draft)
  })
  it.each(['completed', 'committed'] as const)('在列表直接删除 %s 报告并补上更早记录，不打开详情或修改音源', async status => {
    const report: SourceTestDraft = { ...draft, id: 'report', name: '待删除报告', status }
    const older: SourceTestDraft = { ...report, id: 'older', name: '更早报告' }
    api.listSourceTests.mockResolvedValueOnce({ list: [report], pending: [] }).mockResolvedValue({ list: [older], pending: [] })
    api.discardSourceTest.mockResolvedValue({ ok: true })
    const select = vi.fn(), close = vi.fn()
    await act(async () => root.render(<SourceTestHistory onClose={close} onSelect={select} />))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除待删除报告测试记录"]')!.click())
    expect(api.discardSourceTest).toHaveBeenCalledExactlyOnceWith('report')
    expect(container.textContent).not.toContain('待删除报告')
    expect(container.textContent).toContain('更早报告')
    expect(select).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
    expect(api.commitSourceTest).not.toHaveBeenCalled()
  })
  it('在列表删除待处理候选后移除该行并显示空状态', async () => {
    api.listSourceTests.mockResolvedValueOnce({ list: [], pending: [draft] }).mockResolvedValue({ list: [], pending: [] })
    api.discardSourceTest.mockResolvedValue({ ok: true })
    const select = vi.fn()
    await act(async () => root.render(<SourceTestHistory onClose={vi.fn()} onSelect={select} />))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除测试源候选"]')!.click())
    expect(api.discardSourceTest).toHaveBeenCalledExactlyOnceWith(draft.id)
    expect(container.querySelector('[aria-label="待处理音源"]')).toBeNull()
    expect(container.textContent).toContain('暂无测试记录')
    expect(select).not.toHaveBeenCalled()
  })
  it('删除期间阻止重复请求，失败时保留记录并允许重试', async () => {
    const report: SourceTestDraft = { ...draft, status: 'completed' }
    api.listSourceTests.mockResolvedValueOnce({ list: [report], pending: [] }).mockResolvedValue({ list: [], pending: [] })
    let rejectDelete!: (error: Error) => void
    api.discardSourceTest.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDelete = reject })).mockResolvedValue({ ok: true })
    await act(async () => root.render(<SourceTestHistory onClose={vi.fn()} onSelect={vi.fn()} />))
    await act(async () => { const remove = button('删除'); remove.click(); remove.click() })
    expect(api.discardSourceTest).toHaveBeenCalledOnce()
    expect(button('删除中…').disabled).toBe(true)
    await act(async () => rejectDelete(new Error('删除失败，请重试')))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('删除失败，请重试')
    expect(container.textContent).toContain('测试源')
    expect(button('删除').disabled).toBe(false)
    await act(async () => button('删除').click())
    expect(api.discardSourceTest).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('暂无测试记录')
  })
  it('运行中的测试不能从列表删除，仍可查看进度', async () => {
    const running: SourceTestDraft = { ...draft, status: 'running' }
    api.listSourceTests.mockResolvedValue({ list: [running], pending: [] })
    const select = vi.fn()
    await act(async () => root.render(<SourceTestHistory onClose={vi.fn()} onSelect={select} />))
    expect(button('删除').disabled).toBe(true)
    await act(async () => button('删除').click())
    expect(api.discardSourceTest).not.toHaveBeenCalled()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="测试记录"] button')!.click())
    expect(select).toHaveBeenCalledWith(running)
  })
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
