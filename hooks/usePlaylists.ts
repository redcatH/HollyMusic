
import { useCallback, useEffect, useState } from 'react'
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  updatePlaylist,
  type PlaylistSummary,
} from '@/lib/api/playlists'

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

  const rename = useCallback(async (id: number, name: string) => {
    await updatePlaylist(id, { name })
    setPlaylists(prev => prev.map(playlist => (
      playlist.id === id ? { ...playlist, name } : playlist
    )))
  }, [])

  const remove = useCallback(async (id: number) => {
    await deletePlaylist(id)
    setPlaylists(prev => prev.filter(p => p.id !== id))
  }, [])

  return { playlists, loading, reload, create, rename, remove }
}
