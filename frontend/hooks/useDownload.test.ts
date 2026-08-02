/**
 * hooks/useDownload.ts - mapDownloadError 单元测试
 *
 * buildFilename/stripHtml 已移至后端 lib/server/download-utils.ts 的 buildFilenameFromMusicInfo
 * （uid 模式后端组装文件名，前端不再操心），对应测试在后端 download-utils.test.ts。
 */

import { describe, it, expect } from 'vitest'
import { mapDownloadError } from '@/hooks/useDownload'

describe('mapDownloadError', () => {
  it('401 → 请先登录', () => {
    expect(mapDownloadError(401)).toBe('请先登录')
  })

  it('403 → 域名白名单提示', () => {
    expect(mapDownloadError(403)).toBe('该音源域名不在下载白名单')
  })

  it('404 → 找不到歌曲信息', () => {
    expect(mapDownloadError(404)).toBe('找不到歌曲信息，请重新搜索')
  })

  it('413 → 文件过大', () => {
    expect(mapDownloadError(413)).toBe('文件过大，暂不支持下载')
  })

  it('502 → 下载源不可用', () => {
    expect(mapDownloadError(502)).toBe('下载源不可用，请稍后重试')
  })

  it('504 → 下载超时', () => {
    expect(mapDownloadError(504)).toBe('下载超时，请稍后重试')
  })

  it('其他状态码 → 通用提示带状态', () => {
    expect(mapDownloadError(500)).toBe('下载失败 (500)')
    expect(mapDownloadError(418)).toBe('下载失败 (418)')
  })
})
