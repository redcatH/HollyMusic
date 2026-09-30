import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaylistDetail } from '@/hooks/usePlaylistDetail'
import { getPlaylist, type PlaylistDetail } from '@/lib/api/playlists'

vi.mock('@/lib/api/playlists', () => ({ getPlaylist: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('usePlaylistDetail', () => {
  let container: HTMLDivElement
  let root: Root
  let result: ReturnType<typeof usePlaylistDetail>

  function TestPage({ id }: { id: number }) {
    result = usePlaylistDetail(id)
    return null
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.mocked(getPlaylist).mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
  })

  it('切换歌单后忽略旧请求和旧页面的刷新回调', async () => {
    const oldRequest = deferred<PlaylistDetail>()
    const newRequest = deferred<PlaylistDetail>()
    vi.mocked(getPlaylist).mockImplementation(id => id === 1 ? oldRequest.promise : newRequest.promise)

    await act(async () => { root.render(<TestPage id={1} />) })
    const oldReload = result!.reload
    await act(async () => { root.render(<TestPage id={2} />) })
    expect(result!.detail).toBeNull()

    await act(async () => { oldRequest.resolve({ id: 1 } as PlaylistDetail) })
    expect(result!.detail).toBeNull()

    await act(async () => { newRequest.resolve({ id: 2 } as PlaylistDetail) })
    expect(result!.detail?.id).toBe(2)

    await act(async () => { await oldReload() })
    expect(getPlaylist).toHaveBeenCalledTimes(2)
    expect(result!.detail?.id).toBe(2)
  })

  it('刷新失败后清空旧列表并报告错误', async () => {
    vi.mocked(getPlaylist)
      .mockResolvedValueOnce({ id: 1 } as PlaylistDetail)
      .mockRejectedValueOnce(new Error('network error'))

    await act(async () => { root.render(<TestPage id={1} />) })
    expect(result!.detail?.id).toBe(1)

    await act(async () => {
      await expect(result!.reload()).rejects.toThrow('network error')
    })
    expect(result!.detail).toBeNull()
    expect(result!.loading).toBe(false)
    expect(result!.error).toBe('歌单加载失败，请重试')
  })
})
