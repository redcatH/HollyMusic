'use client'

import { useCallback, useEffect, useState } from 'react'
import { getPlaylist, type PlaylistDetail } from '@/lib/api/playlists'

export function usePlaylistDetail(id: number | null) {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (id == null) return
    setLoading(true)
    try {
      const d = await getPlaylist(id)
      setDetail(d)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  return { detail, loading, reload }
}
