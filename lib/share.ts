/**
 * 分享工具：移动端调系统原生分享面板（Web Share API），桌面端/不支持时降级复制链接。
 *
 * 三处复用：SongContextMenu / NowPlaying / PlaylistDetailPage。
 */
import { toast } from './toast'

export interface ShareOptions {
  title: string
  text: string
  url: string
}

/**
 * 分享内容。navigator.share 可用则调系统面板（移动端）；
 * 用户取消（AbortError）静默；不支持/其他失败降级复制链接。
 */
export async function shareContent({ title, text, url }: ShareOptions) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return
    } catch (e) {
      // 用户取消分享，静默忽略；不降级到复制（避免"取消了却弹已复制"的打扰）
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  // ponytail: 桌面端普遍无 navigator.share，降级剪贴板；两套路径已覆盖全部环境
  try {
    await navigator.clipboard.writeText(url)
    toast.success('分享链接已复制')
  } catch {
    toast.error('复制失败，请手动复制')
  }
}

/** 单曲分享链接：首页 ?uid= 自动播放（App.tsx 接收） */
export function buildSongShareUrl(uid: string): string {
  return `${window.location.origin}/?uid=${encodeURIComponent(uid)}`
}

/** 歌单分享链接：首页 ?playlist= 跳转（App.tsx 接收 → /playlists/:id） */
export function buildPlaylistShareUrl(id: number): string {
  return `${window.location.origin}/?playlist=${id}`
}
