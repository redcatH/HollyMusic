'use client'

import { useCallback, useEffect, useState } from 'react'
import { listPlaylists, createPlaylist, type PlaylistSummary } from '@/lib/api/playlists'

export function usePlaylists() {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { list } = await listPlaylists()
      setPlaylists(list)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(async (name: string) => {
    const p = await createPlaylist(name)
    setPlaylists(prev => [p, ...prev])
    return p
  }, [])

  const remove = useCallback((id: number) => {
    setPlaylists(prev => prev.filter(p => p.id !== id))
  }, [])

  return { playlists, loading, reload, create, remove }
}
