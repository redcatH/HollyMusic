
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPlaylist, type PlaylistDetail } from '@/lib/api/playlists'

export function usePlaylistDetail(id: number | null) {
  const currentId = useRef<number | null>(null)
  const requestId = useRef(0)
  const [state, setState] = useState<{
    id: number | null
    detail: PlaylistDetail | null
    loading: boolean
    error: string | null
  }>({ id, detail: null, loading: id != null, error: null })

  const reload = useCallback(async () => {
    if (id == null || currentId.current !== id) return
    const currentRequest = ++requestId.current
    setState({ id, detail: null, loading: true, error: null })
    try {
      const detail = await getPlaylist(id)
      if (currentId.current === id && requestId.current === currentRequest) {
        setState({ id, detail, loading: false, error: null })
      }
    } catch (error) {
      if (currentId.current === id && requestId.current === currentRequest) {
        setState({ id, detail: null, loading: false, error: '歌单加载失败，请重试' })
        throw error
      }
    }
  }, [id])

  useEffect(() => {
    const activeId = currentId
    const activeRequest = requestId
    let cancelled = false
    activeId.current = id
    void Promise.resolve().then(() => {
      if (!cancelled) return reload()
    }).catch(() => {})
    return () => {
      cancelled = true
      activeId.current = null
      activeRequest.current++
    }
  }, [id, reload])

  return {
    detail: state.id === id ? state.detail : null,
    loading: state.id === id ? state.loading : id != null,
    error: state.id === id ? state.error : null,
    reload,
  }
}
