import { useState, useEffect, useCallback } from 'react'
import { historyDb, type HistoryItem } from '@/lib/local-db'
import type { MusicInfo } from '@/lib/types/music'

type SortBy = 'time' | 'count'

export function usePlayHistory(sortBy: SortBy = 'time') {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(0)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const items = await historyDb.getAll(sortBy)
      setHistory(items)
      setCount(await historyDb.count())
    } catch (error) {
      console.error('Failed to load history:', error)
    } finally {
      setLoading(false)
    }
  }, [sortBy])

  const addHistory = useCallback(async (musicInfo: MusicInfo) => {
    try {
      await historyDb.addOrUpdate(musicInfo)
      await loadHistory()
    } catch (error) {
      console.error('Failed to add history:', error)
    }
  }, [loadHistory])

  const removeHistory = useCallback(async (id: number) => {
    try {
      await historyDb.remove(id)
      await loadHistory()
    } catch (error) {
      console.error('Failed to remove history:', error)
    }
  }, [loadHistory])

  const clearHistory = useCallback(async () => {
    try {
      await historyDb.clear()
      await loadHistory()
    } catch (error) {
      console.error('Failed to clear history:', error)
    }
  }, [loadHistory])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return {
    history,
    loading,
    count,
    addHistory,
    removeHistory,
    clearHistory,
    refresh: loadHistory,
  }
}
