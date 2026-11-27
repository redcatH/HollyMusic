import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlatformPluginsPanel } from '@/components/admin/PlatformPluginsPanel'
import { deletePlugin, getPluginAdmin, testPlugin, uploadPlugin } from '@/lib/api/platforms'
import type { PluginAdminView, PluginRevisionView } from '@/lib/platform-plugin-admin'

vi.mock('@/lib/api/platforms', () => ({ deletePlugin: vi.fn(), getPluginAdmin: vi.fn(), testPlugin: vi.fn(), uploadPlugin: vi.fn() }))
vi.mock('@/hooks/usePlatforms', () => ({ usePlatforms: () => [] }))

const emptyView: PluginAdminView = { revisions: [], bindings: [], changes: [] }
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

it('读取失败后结束加载，重试成功后显示空列表并允许上传', async () => {
  const request = vi.mocked(getPluginAdmin)
  let failLoad!: (error: Error) => void
  request
    .mockReturnValueOnce(new Promise((_resolve, reject) => { failLoad = reject }))
    .mockResolvedValueOnce(emptyView)

  await act(async () => { root.render(<PlatformPluginsPanel onOpenSources={vi.fn()} />) })
  const upload = container.querySelector<HTMLInputElement>('input[type="file"]')
  expect(container.querySelector('[role="status"]')?.textContent).toBe('正在读取插件')
  expect(upload?.disabled).toBe(true)

  await act(async () => { failLoad(new Error('平台插件操作失败')) })
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('平台插件操作失败')
  expect(container.textContent).not.toContain('正在读取插件')
  expect(upload?.disabled).toBe(true)

  const retry = container.querySelector('button')
  expect(retry?.textContent).toBe('重试')
  await act(async () => { retry?.click() })
  expect(request).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.textContent).toContain('暂无插件')
  expect(upload?.disabled).toBe(false)
})

it('选文件直接导入，多平台测试默认收起，测试列表后自动填入详情 ID', async () => {
  const revision: PluginRevisionView = {
    id: 'revision',
    manifest: {
      apiVersion: 1, id: 'example', name: '多平台插件', version: '1.0.0',
      platforms: [
        { id: 'qs', name: '汽水', origins: [], capabilities: ['listCharts', 'getChart'] },
        { id: 'tx', name: 'QQ', origins: [], capabilities: ['searchSongs'] },
      ],
    },
    tests: {},
  }
  const importedView: PluginAdminView = {
    revisions: [revision],
    bindings: revision.manifest.platforms.flatMap(({ id, capabilities }) =>
      capabilities.map(capability => ({ platform: id, capability, revisionId: revision.id }))),
    changes: [],
  }
  const result = { ok: true, count: 1, sampleId: 'chart-101', testedAt: '2026-11-27T00:00:00Z' }
  vi.mocked(getPluginAdmin).mockResolvedValueOnce(emptyView).mockResolvedValueOnce(importedView).mockResolvedValue({
    ...importedView,
    revisions: [{ ...revision, tests: { 'qs:listCharts': result } }],
  })
  vi.mocked(uploadPlugin).mockResolvedValue({ revision, activeCount: 3, conflicts: [] })
  vi.mocked(testPlugin).mockResolvedValue(result)
  await act(async () => { root.render(<PlatformPluginsPanel onOpenSources={vi.fn()} />) })

  const upload = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File(['script'], 'plugins.js', { type: 'text/javascript' })
  Object.defineProperty(upload, 'files', { value: [file] })
  await act(async () => { upload.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(uploadPlugin).toHaveBeenCalledExactlyOnceWith(file)
  expect(testPlugin).not.toHaveBeenCalled()
  expect(container.querySelector('[role="status"]')?.textContent).toContain('3 项功能已启用')
  expect(container.querySelectorAll('details')).toHaveLength(2)
  expect(container.querySelectorAll('details[open]')).toHaveLength(0)
  const capabilities = container.querySelector('ul[aria-label="汽水功能"]')
  expect(capabilities?.classList.contains('flex-wrap')).toBe(true)
  expect(capabilities?.children).toHaveLength(2)
  expect(capabilities?.querySelector('button[aria-label="停用汽水榜单列表"]')).toBeTruthy()

  const testPanel = container.querySelector('details')!
  await act(async () => { testPanel.querySelector('summary')!.click() })
  const detailSample = testPanel.querySelector<HTMLInputElement>('input[aria-label="汽水榜单详情测试样本"]')!
  expect(detailSample.value).toBe('')
  await act(async () => { testPanel.querySelector<HTMLButtonElement>('button[aria-label="测试汽水榜单列表"]')!.click() })
  expect(testPlugin).toHaveBeenCalledExactlyOnceWith(revision.id, 'qs', 'listCharts', '')
  expect(detailSample.value).toBe('chart-101')
})

it('删除前要求确认，删除最后一个插件后仍显示变更记录', async () => {
  const manifest: PluginRevisionView['manifest'] = {
    apiVersion: 1, id: 'example', name: '测试插件', version: '2.0.0',
    platforms: [{ id: 'qs', name: '汽水', origins: [], capabilities: ['searchSongs'] }],
  }
  vi.mocked(getPluginAdmin).mockResolvedValueOnce({
    ...emptyView,
    revisions: [{ id: 'new', manifest, tests: {} }, { id: 'old', manifest: { ...manifest, version: '1.0.0' }, tests: {} }],
  }).mockResolvedValueOnce({
    ...emptyView,
    changes: [{ id: 'change', createdAt: '2026-11-27T00:00:00Z', changes: [], deletion: { name: manifest.name, revisionCount: 2 } }],
  })
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  vi.stubGlobal('confirm', confirm)
  vi.mocked(deletePlugin).mockResolvedValue({ deleted: 2 })
  await act(async () => { root.render(<PlatformPluginsPanel onOpenSources={vi.fn()} />) })

  const buttons = [...container.querySelectorAll('button')]
  expect(buttons.some(item => item.textContent === '删除此版本')).toBe(true)
  const remove = buttons.find(item => item.textContent?.trim() === '删除插件')!
  await act(async () => { remove.click() })
  expect(deletePlugin).not.toHaveBeenCalled()
  await act(async () => { remove.click() })
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('全部 2 个版本'))
  expect(deletePlugin).toHaveBeenCalledExactlyOnceWith('new', 'package')
  expect(container.textContent).toContain('暂无插件')
  expect(container.textContent).toContain('删除 测试插件（2 个版本）')
  expect(container.textContent).not.toContain('回滚')
})
