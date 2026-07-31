'use client'

import { useCallback, useRef, useState } from 'react'
import { search } from '@/lib/api/search'
import type { Song, SourceType } from '@/lib/types/music'

const ALL_SOURCES: SourceType[] = ['tx', 'wy', 'kw', 'kg', 'mg']

export function useSearch() {
  const [results, setResults] = useState<Song[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const reqIdRef = useRef(0)

  const run = useCallback(async (kw: string, source: SourceType | 'all') => {
    if (!kw.trim()) {
      setResults([])
      return
    }
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const sources = source === 'all' ? ALL_SOURCES : [source]
      const responses = await Promise.all(
        sources.map(s =>
          search(s, kw, 1, 30)
            .then(r => r.list)
            .catch(() => [] as Song[])
        )
      )
      if (reqId !== reqIdRef.current) return // 过期请求，丢弃
      setResults(responses.flat())
    } catch (e) {
      if (reqId !== reqIdRef.current) return
      setError(e instanceof Error ? e.message : '搜索失败')
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [])

  return { results, loading, error, keyword, setKeyword, run }
}
