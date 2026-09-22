import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceMatrix } from '@/components/admin/SourceMatrix'
import { SourcesPanel } from '@/components/admin/SourcesPanel'
import type { AdminSource } from '@/lib/api/admin-sources'

const api = vi.hoisted(() => ({
  listSources: vi.fn(), bulkUpdateSources: vi.fn(), updateSource: vi.fn(),
  deleteSource: vi.fn(), createSource: vi.fn(), importSourceSubscription: vi.fn(),
  uploadScript: vi.fn(), updateSourceSubscription: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('@/lib/api/admin-sources', () => api)
vi.mock('@/lib/toast', () => ({ toast }))

const sources: AdminSource[] = [
  { path: 'a.js', name: 'A', enabled: true, priority: 1, pt: ['kw', 'tx'], scriptExists: true },
  { path: 'b.js', name: 'B', enabled: true, priority: 2, pt: ['kw'], scriptExists: true },
]
let container: HTMLDivElement
let root: Root

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
  if (!found) throw new Error(`button missing: ${text}`)
  return found
}

function labeled<T extends Element = HTMLButtonElement>(label: string): T {
  const found = [...container.querySelectorAll('[aria-label]')].find(item => item.getAttribute('aria-label') === label)
  if (!found) throw new Error(`label missing: ${label}`)
  return found as T
}

async function click(element: HTMLElement) { await act(async () => { element.click() }) }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('confirm', vi.fn(() => true))
  api.listSources.mockResolvedValue({ list: sources })
  api.bulkUpdateSources.mockResolvedValue({ updated: 1 })
  api.deleteSource.mockResolvedValue({ ok: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('平台矩阵', () => {
  it('批量关闭会清空单平台音源时明确阻止，不悄悄跳过部分行', async () => {
    await act(async () => { root.render(<SourceMatrix sources={sources} reload={vi.fn()} />) })
    await click(button('酷我'))
    expect(api.bulkUpdateSources).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('B'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('混合状态批量开启只修改启用源，保留各源其它平台', async () => {
    await act(async () => { root.render(<SourceMatrix sources={[
      ...sources, { ...sources[0], path: 'c.js', name: 'C', enabled: false },
    ]} reload={vi.fn()} />) })
    await click(button('腾讯'))
    expect(api.bulkUpdateSources).toHaveBeenCalledWith([
      { path: 'a.js', pt: ['kw', 'tx'] }, { path: 'b.js', pt: ['kw', 'tx'] },
    ])
  })

  it('保存与重拉都失败时回滚单元格并解除忙碌状态', async () => {
    api.bulkUpdateSources.mockRejectedValueOnce(new Error('保存失败'))
    const reload = vi.fn().mockRejectedValue(new Error('刷新失败'))
    const onBusyChange = vi.fn()
    await act(async () => { root.render(<SourceMatrix sources={sources} reload={reload} onBusyChange={onBusyChange} />) })
    await click(labeled('A 腾讯 允许'))
    expect(labeled('A 腾讯 允许').getAttribute('aria-pressed')).toBe('true')
    expect(labeled<HTMLButtonElement>('A 腾讯 允许').disabled).toBe(false)
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })

  it('刚停用首行时立即重排，下一次上移仍作用于正确音源', async () => {
    const reload = vi.fn()
    await act(async () => { root.render(<SourceMatrix sources={[
      ...sources, { ...sources[0], path: 'c.js', name: 'C', priority: 3 },
    ]} reload={reload} />) })
    const firstRow = container.querySelector('tbody tr')!
    await click([...firstRow.querySelectorAll('button')].find(item => item.textContent === '启用')!)
    const names = [...container.querySelectorAll('tbody tr')].map(row => row.querySelector('.font-medium')?.textContent)
    expect(names).toEqual(['B', 'C', 'A'])
    const cRow = container.querySelectorAll('tbody tr')[1]
    await click(cRow.querySelector<HTMLButtonElement>('button[title="提高优先级（取链时更先尝试）"]')!)
    expect(api.bulkUpdateSources).toHaveBeenLastCalledWith([
      { path: 'c.js', priority: 1 }, { path: 'b.js', priority: 2 },
    ])
  })

  it('同一轮连续点击只发一次更新', async () => {
    let finish!: (result: { updated: number }) => void
    api.bulkUpdateSources.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await act(async () => { root.render(<SourceMatrix sources={sources} reload={vi.fn()} />) })
    await act(async () => { labeled('A 腾讯 允许').click(); labeled('A 酷我 允许').click() })
    expect(api.bulkUpdateSources).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ updated: 1 }) })
  })
})

describe('音源列表', () => {
  it('删除已勾选源后清理选择，后续批量操作不携带已删除路径', async () => {
    await act(async () => { root.render(<SourcesPanel />) })
    await click(labeled<HTMLInputElement>('选择 A'))
    api.listSources.mockResolvedValue({ list: [sources[1]] })
    await click(container.querySelector<HTMLButtonElement>('button[title="删除"]')!)
    expect(container.textContent).not.toContain('已选 1 项')
    expect(labeled<HTMLInputElement>('全选').checked).toBe(false)
    await click(labeled<HTMLInputElement>('选择 B'))
    await click(button('批量禁用'))
    expect(api.bulkUpdateSources).toHaveBeenCalledWith([{ path: 'b.js', enabled: false }])
  })

  it('批量保存期间禁止切换视图和发起单条编辑', async () => {
    let finish!: (result: { updated: number }) => void
    api.bulkUpdateSources.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await act(async () => { root.render(<SourcesPanel />) })
    await click(labeled<HTMLInputElement>('选择 A'))
    await click(button('批量禁用'))
    expect(button('平台矩阵').matches(':disabled')).toBe(true)
    await click(button('平台矩阵'))
    await click(button('启用'))
    expect(api.updateSource).not.toHaveBeenCalled()
    expect(container.textContent).toContain('脚本路径')
    await act(async () => { finish({ updated: 1 }) })
    expect(button('平台矩阵').matches(':disabled')).toBe(false)
  })

  it('旧的列表响应不会覆盖更新的响应', async () => {
    let finishOld!: (result: { list: AdminSource[] }) => void
    api.listSources.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
    api.listSources.mockResolvedValue({ list: [sources[1]] })
    await act(async () => { root.render(<StrictMode><SourcesPanel /></StrictMode>) })
    await act(async () => { finishOld({ list: sources }) })
    expect(container.querySelector('[aria-label="选择 A"]')).toBeNull()
    expect(labeled('选择 B')).toBeTruthy()
  })
})
