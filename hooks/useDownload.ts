/**
 * 下载 hook
 * 先获取播放直链，再通过 /api/download 代理触发浏览器保存。
 * 需要登录（/api/download 受 requireUser 保护）。
 */

import { useState, useCallback } from 'react'
import { getMusicUrl } from '@/lib/api/music'
import type { MusicInfo } from '@/lib/types/music'

function buildFilename(mi: MusicInfo): string {
  const singer = mi.singer || 'unknown'
  const name = mi.name || 'audio'
  return `${singer} - ${name}.mp3`
}

export function useDownload() {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = useCallback(async (musicInfo: MusicInfo) => {
    setDownloading(true)
    setError(null)
    try {
      const { url } = await getMusicUrl(musicInfo, '320k')
      const filename = buildFilename(musicInfo)
      const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
      // 触发浏览器下载
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '下载失败'
      setError(msg)
      // 401 时提示登录
      if (msg.includes('未登录') || msg.includes('401')) {
        setError('请先登录')
      }
    } finally {
      setDownloading(false)
    }
  }, [])

  return { download, downloading, error }
}
