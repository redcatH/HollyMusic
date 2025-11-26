/**
 * 下载管理工具函数库
 * 提供浏览器兼容的下载功能实现
 */

/**
 * 尝试使用 <a> 标签进行同源或 CORS 允许的直连下载
 * @param url 要下载的 URL
 * @param filename 下载后保存的文件名
 * @returns 是否成功触发下载
 */
export function tryAnchorDownload(url: string, filename: string): boolean {
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    // 某些浏览器要求链接在 DOM 中才能正常工作
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    return true
  } catch (err) {
    console.error('tryAnchorDownload failed:', err)
    return false
  }
}

/**
 * 使用 fetch 将远端资源下载为 blob 并触发浏览器保存
 * 支持 CORS 跨域下载，更可靠
 * @param url 要下载的 URL
 * @param filename 下载后保存的文件名
 * @returns 是否成功完成下载
 */
export async function fetchToBlob(url: string, filename: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      // 不发送 credentials 避免某些 CORS 场景问题，需要时可改为 'include'
      credentials: 'omit',
    })

    if (!response.ok) {
      console.error('fetchToBlob: response not ok', response.status, response.statusText)
      return false
    }

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)

    try {
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return true
    } finally {
      // 释放对象 URL
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
      }, 100)
    }
  } catch (err) {
    console.error('fetchToBlob failed:', err)
    return false
  }
}

/**
 * 执行 HEAD 请求检查 URL 是否可访问
 * 用于检测 CORS 或网络问题
 * @param url 要检查的 URL
 * @returns 是否成功连接
 */
export async function headCheck(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      credentials: 'omit',
    })
    return response.ok
  } catch (err) {
    console.error('headCheck failed:', err)
    return false
  }
}

/**
 * 从 URL 或 Content-Disposition 响应头中提取文件名
 * @param url 源 URL
 * @param contentDisposition 可选的 Content-Disposition 响应头值
 * @returns 提取到的文件名或 null
 */
export function extractFilenameFromUrl(url: string, contentDisposition?: string): string | null {
  // 优先尝试从 Content-Disposition 提取
  if (contentDisposition) {
    const match = contentDisposition.match(/filename\*=(?:UTF-8'')?(.+?)(?:;|$)/)
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1])
      } catch {}
    }
    const match2 = contentDisposition.match(/filename=["']?([^"';]+)["']?(?:;|$)/)
    if (match2 && match2[1]) {
      return match2[1]
    }
  }

  // 从 URL 路径提取
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const parts = pathname.split('/')
    const lastPart = parts[parts.length - 1]
    if (lastPart && !lastPart.startsWith('?')) {
      return lastPart
    }
  } catch {}

  return null
}

/**
 * 从 URL 路径推断文件扩展名
 * @param url 源 URL
 * @returns 文件扩展名（含点号），如 '.mp3'；无法推断时返回 '.mp3'
 */
export function inferExtensionFromUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const match = pathname.match(/\.(\w+)($|\?)/)
    if (match && match[1]) {
      const ext = match[1].toLowerCase()
      // 仅允许常见音频格式
      if (['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'wma'].includes(ext)) {
        return `.${ext}`
      }
    }
  } catch {}
  return '.mp3' // 默认扩展名
}

/**
 * 清洁文件名，移除非法字符
 * @param filename 原始文件名
 * @returns 清洁后的文件名
 */
export function sanitizeFilename(filename: string): string {
  // 移除 Windows 非法字符: < > : " / \ | ? *
  // 以及其他可能导致问题的字符
  let cleaned = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()

  // 移除连续的空格和点
  cleaned = cleaned.replace(/\.+/g, '.').replace(/\s+/g, ' ')

  // 限制长度（考虑扩展名）
  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200)
  }

  // 避免以点或空格结尾
  cleaned = cleaned.replace(/[\s.]+$/, '')

  return cleaned || 'download'
}

/**
 * 生成完整的下载文件名
 * @param songName 歌曲名称
 * @param singer 歌手名称
 * @param extension 文件扩展名（可选，默认 .mp3）
 * @returns 完整的下载文件名，不超过 255 字符
 */
export function generateDownloadFilename(
  songName: string,
  singer: string,
  extension: string = '.mp3'
): string {
  const cleanedName = sanitizeFilename(songName)
  const cleanedSinger = sanitizeFilename(singer)

  // 组合文件名：歌曲 - 歌手.扩展名
  let filename = `${cleanedName} - ${cleanedSinger}${extension}`

  // 最终长度限制
  if (filename.length > 255) {
    // 保留扩展名长度，压缩中间部分
    const extLen = extension.length
    const maxLen = 255 - extLen
    filename = filename.substring(0, maxLen) + extension
  }

  return filename
}
