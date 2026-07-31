'use client'

import { useCallback, useEffect, useState } from 'react'
import { getRandomSongs } from '@/lib/api/random'
import type { Song } from '@/lib/types/music'

export function useRandomSongs(size = 30) {
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { list } = await getRandomSongs(size)
      setSongs(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [size])

  useEffect(() => {
    reload()
  }, [reload])

  return { songs, loading, error, reload }
}
