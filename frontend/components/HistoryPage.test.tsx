import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoryPage } from '../src/routes/HistoryPage'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAuthStore } from '@/hooks/useAuth'
import { listHistory, removeHistoryEntry, clearHistory, type HistoryEntry } from '@/lib/api/history'
import { toast } from '@/lib/toast'
import { toTrack } from '@/lib/types/player'

vi.mock('@/lib/api/history', () => ({ listHistory: vi.fn(), removeHistoryEntry: vi.fn(), clearHistory: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/shared/CoverImage', () => ({ CoverImage: () => null }))
vi.mock('@/hooks/useDownload', () => ({ useDownload: () => ({ download: vi.fn(), downloading: false, error: null }) }))

const entries: HistoryEntry[] = [
  { id: 99, songId: null, musicInfo: null, playedAt: '2026-11-11' },
  ...[11, 22].map(id => ({ id, songId: `kw-${id}`, playedAt: '2026-11-11', musicInfo: {
    name: `歌曲${id}`, singer: '歌手', source: 'kw', songmid: String(id), interval: '03:00',
    types: [], _types: {}, typeUrl: {},
  } as NonNullable<HistoryEntry['musicInfo']> })),
]
let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(listHistory).mockResolvedValue({ list: entries, total: entries.length })
  vi.mocked(removeHistoryEntry).mockResolvedValue({ deleted: 1 })
  vi.mocked(clearHistory).mockResolvedValue({ deleted: 3 })
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => { root.render(<HistoryPage />) })
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

function deleteButton(id: number) {
  return container.querySelector(`[aria-label="删除 歌曲${id} 的播放记录"]`) as HTMLButtonElement | null
}

it('每行常显删除入口，按过滤后的记录 ID 删除，保留其他歌曲和更多操作', async () => {
  expect(deleteButton(11)).not.toBeNull()
  expect(deleteButton(11)!.className).not.toContain('opacity-0')
  expect(container.querySelectorAll('[aria-label="更多操作"]')).toHaveLength(2)
  await act(async () => { deleteButton(22)!.click() })
  expect(removeHistoryEntry).toHaveBeenCalledWith(22)
  expect(clearHistory).not.toHaveBeenCalled()
  expect(deleteButton(22)).toBeNull()
  expect(deleteButton(11)).not.toBeNull()
  expect(toast.success).toHaveBeenCalledWith('已删除播放记录')
})

it('删除失败保留记录，提示错误并允许重试', async () => {
  vi.mocked(removeHistoryEntry).mockRejectedValueOnce(new Error('network'))
  await act(async () => { deleteButton(11)!.click() })
  expect(deleteButton(11)!.disabled).toBe(false)
  expect(toast.error).toHaveBeenCalledWith('删除播放记录失败，请重试')
  await act(async () => { deleteButton(11)!.click() })
  expect(deleteButton(11)).toBeNull()
})

it('请求中禁用删除按钮，删除最后一条后显示空状态', async () => {
  let resolve!: (value: { deleted: number }) => void
  vi.mocked(removeHistoryEntry).mockReturnValueOnce(new Promise(done => { resolve = done }))
  await act(async () => { deleteButton(11)!.click() })
  expect(deleteButton(11)!.disabled).toBe(true)
  await act(async () => { deleteButton(11)!.click() })
  expect(removeHistoryEntry).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ deleted: 1 }) })
  await act(async () => { deleteButton(22)!.click() })
  expect(container.textContent).toContain('暂无播放记录')
})

it('清空仍需确认，确认后清空整个列表', async () => {
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  vi.stubGlobal('confirm', confirm)
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('清空'))!
  await act(async () => button.click())
  expect(clearHistory).not.toHaveBeenCalled()
  await act(async () => button.click())
  expect(clearHistory).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('暂无播放记录')
})

it('删除前发起的刷新延迟返回时，不恢复已删除记录', async () => {
  let resolve!: (value: { list: HistoryEntry[]; total: number }) => void
  vi.mocked(listHistory).mockReturnValueOnce(new Promise(done => { resolve = done }))
  await act(async () => {
    usePlayerStore.setState({ currentTrack: toTrack({ uid: entries[1].songId!, musicInfo: entries[1].musicInfo! }) })
  })
  await act(async () => { deleteButton(11)!.click() })
  await act(async () => { resolve({ list: entries, total: entries.length }) })
  expect(deleteButton(11)).toBeNull()
  expect(deleteButton(22)).not.toBeNull()
})
