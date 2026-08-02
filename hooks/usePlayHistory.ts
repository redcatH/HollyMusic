
import { useCallback, useEffect, useState } from 'react'
import { listHistory, clearHistory, type HistoryEntry } from '@/lib/api/history'

export function usePlayHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { list } = await listHistory()
      setEntries(list)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const clear = useCallback(async () => {
    await clearHistory()
    setEntries([])
  }, [])

  return { entries, loading, reload, clear }
}
