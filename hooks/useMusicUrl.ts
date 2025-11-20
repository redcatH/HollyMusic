'use client'

import { useCallback } from 'react'
import type { MusicInfo } from '@/lib/types/music'

interface MusicUrlResponse {
  success: boolean
  data?: {
    url: string
    bitrate?: number
  }
  error?: {
    code: string
    message: string
  }
}

/**
 * 获取音乐播放 URL 的 hook
 * 根据 API-README，需要 POST 请求并传递完整的 musicInfo 对象
 * 返回的 URL 将通过 /api/proxy 代理，避免跨域问题
 */
export function useMusicUrl() {
  const getMusicUrl = useCallback(
    async (musicInfo: MusicInfo, quality: string = '128k'): Promise<string | null> => {
      try {
        console.log('useMusicUrl: 开始请求', { musicInfo, quality })
        
        // 只发送 API 需要的字段
        const requestBody = {
          musicInfo: {
            name: musicInfo.name,
            singer: musicInfo.singer,
            source: musicInfo.source,
            songmid: musicInfo.songmid,
            _types: musicInfo._types,
          },
          quality,
        }
        
        console.log('useMusicUrl: 请求体', requestBody)
        
        const response = await fetch('/api/music-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })

        console.log('useMusicUrl: 收到响应', response.status)
        const data: MusicUrlResponse = await response.json()
        console.log('useMusicUrl: 响应数据', data)

        if (data.success && data.data?.url) {
          // 将获得的 URL 通过 proxy 代理
          // 使用新格式：/api/proxy/[encodedUrl] 而不是 query string
          // 这样 Howler.js 能从路径更容易地识别文件格式
          const proxyUrl = `/api/proxy/${encodeURIComponent(data.data.url)}`
          console.log('useMusicUrl: 返回 proxy URL', proxyUrl)
          return proxyUrl
        } else {
          console.error('获取音乐 URL 失败:', data.error?.message)
          return null
        }
      } catch (err) {
        console.error('获取音乐 URL 错误:', err)
        return null
      }
    },
    []
  )

  return { getMusicUrl }
}
