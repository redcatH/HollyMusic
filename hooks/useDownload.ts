/**
 * 下载 hook
 * 先获取播放直链，再用 fetch 流式拉取以跟踪下载进度，最后保存为文件。
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

/** 把 Blob 触发浏览器保存为文件 */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放，确保下载已触发
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useDownload() {
  const [downloading, setDownloading] = useState(false)
  /** 下载进度 0-100；null 表示未在下载或无 content-length 无法计量 */
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const download = useCallback(async (musicInfo: MusicInfo) => {
    setDownloading(true)
    setError(null)
    setProgress(0)
    try {
      const { url } = await getMusicUrl(musicInfo, '320k')
      const filename = buildFilename(musicInfo)
      const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`

      // fetch 流式拉取以跟踪进度
      const resp = await fetch(downloadUrl)
      if (!resp.ok) {
        throw new Error(resp.status === 401 ? '请先登录' : `下载失败: ${resp.status}`)
      }

      const total = Number(resp.headers.get('content-length')) || 0
      const reader = resp.body?.getReader()

      if (reader && total > 0) {
        // 有 content-length：边读边上报百分比
        const chunks: BlobPart[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            // TS 5.7+ Uint8Array 泛型化导致与 BlobPart 类型不兼容，运行时是合法的，窄化断言
            chunks.push(value as BlobPart)
            received += value.length
            setProgress(Math.min(100, Math.round((received / total) * 100)))
          }
        }
        const blob = new Blob(chunks, {
          type: resp.headers.get('content-type') || 'audio/mpeg',
        })
        saveBlob(blob, filename)
      } else {
        // 无 content-length 或无 reader：退化为整段 blob（无法显示百分比）
        setProgress(null)
        const blob = await resp.blob()
        saveBlob(blob, filename)
      }
    } catch (e) {
      let msg = e instanceof Error ? e.message : '下载失败'
      if (msg.includes('未登录') || msg.includes('401')) msg = '请先登录'
      setError(msg)
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }, [])

  return { download, downloading, progress, error }
}
