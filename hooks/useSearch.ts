'use client'

import { MusicInfo } from '@/lib/types/music'
import { useState, useCallback, useRef } from 'react'

export interface SearchResponse {
  success: boolean
  data?: {
    list: MusicInfo[]
    total: number
  }
  error?: {
    code: string
    message: string
  }
}

interface UseSearchOptions {
  debounceMs?: number
  cacheMs?: number
}

interface SearchCache {
  results: SearchResponse
  timestamp: number
}

export function useSearch(options: UseSearchOptions = {}) {
  const { cacheMs = 1000 * 60 * 30 } = options
  
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('kw')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const cacheRef = useRef<Map<string, SearchCache>>(new Map())

  const search = useCallback(
    async (keyword: string, selectedSource: string = source, page: number = 1, limit: number = 30) => {
      if (!keyword.trim()) {
        setResults(null)
        setError(null)
        return
      }

      const cacheKey = `${selectedSource}:${keyword}:${page}:${limit}`
      const cached = cacheRef.current.get(cacheKey)
      
      // 检查缓存是否有效
      if (cached && Date.now() - cached.timestamp < cacheMs) {
        setResults(cached.results)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          source: selectedSource,
          keyword: keyword,
          page: page.toString(),
          limit: limit.toString(),
        })

        const response = await fetch(`/api/search?${params}`)
        const data: SearchResponse = await response.json()

        if (data.success && data.data) {
          setResults(data)
          // 缓存结果
          cacheRef.current.set(cacheKey, {
            results: data,
            timestamp: Date.now(),
          })
        } else {
          setError(data.error?.message || '搜索失败')
          setResults(null)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '网络请求失败'
        setError(message)
        setResults(null)
      } finally {
        setLoading(false)
      }
    },
    [source, cacheMs]
  )

  const handleSearch = useCallback(
    (keyword: string, selectedSource?: string) => {
      setQuery(keyword)
      if (!keyword.trim()) {
        setResults(null)
        setError(null)
        return
      }
      // 立即执行搜索，不防抖
      search(keyword, selectedSource || source, 1)
    },
    [search, source]
  )

  const handleSourceChange = useCallback(
    (newSource: string) => {
      setSource(newSource)
      // 如果已有查询词，用新音源重新搜索
      if (query.trim()) {
        search(query, newSource, 1)
      }
    },
    [query, search]
  )

  const clearCache = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  return {
    query,
    setQuery,
    source,
    setSource: handleSourceChange,
    results,
    loading,
    error,
    search: handleSearch,
    clearCache,
  }
}
