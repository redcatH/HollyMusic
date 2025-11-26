'use client'

import { useCallback, useState } from 'react'
import type { MusicInfo } from '@/lib/types/music'
import { useMusicUrl } from './useMusicUrl'
import { 
  tryAnchorDownload, 
  fetchToBlob, 
  generateDownloadFilename 
} from '@/lib/download-manager'

export type DownloadErrorCode = 
  | 'DIRECT_CORS' 
  | 'DIRECT_NETWORK' 
  | 'PROXY_ERROR' 
  | 'UNKNOWN'

interface DownloadState {
  isDownloading: boolean
  error: DownloadErrorCode | null
  errorMessage: string | null
}

/**
 * 客户端下载 hook
 * 流程：
 * 1. 调用 getMusicUrlRaw 获取原始远端 URL
 * 2. 尝试直连下载（使用 <a download> 或 fetch->blob）
 * 3. 若直连失败（CORS / 网络错误），回退到 proxy URL 下载
 * 4. 若仍然失败，返回错误信息
 */
export function useDownload() {
  const { getMusicUrlRaw, getMusicUrl } = useMusicUrl()
  const [state, setState] = useState<DownloadState>({
    isDownloading: false,
    error: null,
    errorMessage: null,
  })

  /**
   * 主下载逻辑：直连优先 -> proxy 回退
   * 尝试顺序：
   * 1. fetch->blob（更可靠的文件名设置）
   * 2. <a download>（备选方案）
   * 3. proxy URL 回退
   */
  const startDownload = useCallback(
    async (musicInfo: MusicInfo, quality: string = '128k'): Promise<boolean> => {
      setState({
        isDownloading: true,
        error: null,
        errorMessage: null,
      })

      const filename = generateDownloadFilename(musicInfo.name, musicInfo.singer)

      try {

                // 步骤 4: 直连失败，回退到 proxy URL
        console.log('useDownload:  proxy...')
        const proxyUrl = await getMusicUrl(musicInfo, quality)

        if (proxyUrl) {
          console.log('useDownload: 尝试 proxy 下载', proxyUrl)
          const proxySuccess = await fetchToBlob(proxyUrl, filename)
          if (proxySuccess) {
            setState({
              isDownloading: false,
              error: null,
              errorMessage: null,
            })
            return true
          }
        }

        // 步骤 1: 尝试获取原始 URL（直连）
        console.log('useDownload: 尝试直连下载...')
        const directUrl = await getMusicUrlRaw(musicInfo, quality)

        if (directUrl) {
          // 步骤 2: 优先尝试 fetch->blob（更可靠的文件名设置）
          console.log('useDownload: 尝试 fetch->blob 下载', directUrl)
          const blobSuccess = await fetchToBlob(directUrl, filename)
          if (blobSuccess) {
            setState({
              isDownloading: false,
              error: null,
              errorMessage: null,
            })
            return true
          }

          // 步骤 3: fetch->blob 失败，回退到 <a download>
          console.log('useDownload: fetch->blob 失败，尝试 anchor 下载')
          const anchorSuccess = tryAnchorDownload(directUrl, filename)
          if (anchorSuccess) {
            setState({
              isDownloading: false,
              error: null,
              errorMessage: null,
            })
            return true
          }

          console.warn('useDownload: 直连下载失败，原因可能是 CORS 或网络问题')
        }



        // 步骤 5: 所有尝试都失败
        const errorMsg = '下载失败，请稍后重试'
        setState({
          isDownloading: false,
          error: 'PROXY_ERROR',
          errorMessage: errorMsg,
        })
        return false
      } catch (err) {
        console.error('useDownload: 下载出错', err)
        const errorMsg = err instanceof Error ? err.message : '未知错误'
        setState({
          isDownloading: false,
          error: 'UNKNOWN',
          errorMessage: errorMsg,
        })
        return false
      }
    },
    [getMusicUrlRaw, getMusicUrl]
  )

  return {
    startDownload,
    isDownloading: state.isDownloading,
    error: state.error,
    errorMessage: state.errorMessage,
  }
}
