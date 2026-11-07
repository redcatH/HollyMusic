/**
 * 歌曲右键菜单（全局单例，由 context-menu-store 驱动）。
 *
 * 设计：
 * - 桌面：fixed 定位小菜单，边界检测靠右/下翻转，右键或行内"⋯"触发
 * - 手机（<768px）：同一份菜单项渲染为底部 action sheet（iOS/Android 通用惯例），点遮罩关闭
 * - 桌面 outside-click（document mousedown），手机复用背景层点击判定；均支持 ESC
 * - 「加入歌单」自管 AddToPlaylistDialog，零回调透传
 * - 动作全部走 store action / 现有 hook，与 SongRow 一致
 */

import { useEffect, useRef, useState } from 'react'
import { Play, ListPlus, Plus, Heart, ListMusic, ListMinus, Download, Share2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { useAuthStore } from '@/hooks/useAuth'
import { useDownload } from '@/hooks/useDownload'
import type { Track } from '@/lib/types/player'
import { toast } from '@/lib/toast'
import { removeSongsFromPlaylist } from '@/lib/api/playlists'
import { shareContent, buildSongShareUrl } from '@/lib/share'
import { AddToPlaylistDialog } from '../../frontend/src/components/playlists/AddToPlaylistDialog'
import { ModalMask } from '@/components/shared/ModalMask'
import { DownloadDialog } from './DownloadDialog'
// ponytail: AddToPlaylistDialog 已移至 frontend/src/components/playlists，
// 根目录共享代码用相对路径引用 frontend 副本，确保 react-router context 与 BrowserRouter 同源，
// 避免双副本导致 context 为 null（黑屏 bug 根因）

const MENU_WIDTH = 192
const MENU_MAX_HEIGHT = 360
const MOBILE_QUERY = '(max-width: 767px), (max-height: 499px)'

/** 手机端判定（与 AiPlaylistPage 同款 matchMedia 监听，无第三方依赖） */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  )
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const update = () => setIsMobile(mql.matches)
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return isMobile
}

export function SongContextMenu() {
  const menu = useContextMenuStore(s => s.menu)
  const close = useContextMenuStore(s => s.close)
  const dismiss = useContextMenuStore(s => s.dismiss)
  const playTrack = usePlayerStore(s => s.playTrack)
  const addNext = usePlayerStore(s => s.addNext)
  const addToQueue = usePlayerStore(s => s.addToQueue)
  const uid = menu?.track.uid
  const isFav = useFavoritesStore(s => s.ids.has(uid ?? ''))
  const toggleFav = useFavoritesStore(s => s.toggle)
  const authenticated = useAuthStore(s => s.authenticated)
  const { download } = useDownload()
  const [playlistUid, setPlaylistUid] = useState<string | null>(null)
  const [downloadTrack, setDownloadTrack] = useState<Track | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // 手机面板交由共享背景层判断完整点击，避免 mousedown 提前绕过拖动保护。
    if (!isMobile) document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      if (!isMobile) document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, close, isMobile])

  // 「加入歌单」弹窗独立于菜单挂载：点「加入歌单」会 dismiss() 菜单，弹窗不能跟着被卸载
  // （旧结构在下方早返回 null，导致弹窗闪没 + playlistUid 残留，下次开菜单直接弹出弹窗）
  const playlistDialog = playlistUid && (
    <AddToPlaylistDialog uid={playlistUid} onClose={() => setPlaylistUid(null)} />
  )
  const downloadDialog = downloadTrack && authenticated && (
    <DownloadDialog
      key={downloadTrack.uid}
      track={downloadTrack}
      onClose={() => setDownloadTrack(null)}
      onDownload={quality => download({ uid: downloadTrack.uid, quality })}
    />
  )

  if (!menu) return <>{playlistDialog}{downloadDialog}</>
  const { track, x, y, playlistEntry } = menu
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8)

  const handleShare = () => {
    void shareContent({
      title: track.name,
      text: `${track.name} - ${track.artist}`,
      url: buildSongShareUrl(track.uid),
    })
    dismiss()
  }

  const handleRemoveFromPlaylist = async () => {
    if (!playlistEntry) return
    dismiss()
    try {
      await removeSongsFromPlaylist(playlistEntry.playlistId, playlistEntry.entryId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移出歌单失败')
      return
    }
    try {
      await playlistEntry.onRemoved()
      toast.success('已移出歌单')
    } catch {
      toast.warning('已移出歌单，但刷新失败，请重试')
    }
  }

  // 两套布局共用的菜单项列表（addNext/addToQueue 入插播队列必生效，toast 恒真）
  const menuItems = (
    <>
      <MenuItem icon={Play} label="播放" onClick={() => { void playTrack(track); dismiss() }} />
      <MenuItem icon={Plus} label="下一首播放" onClick={() => { addNext(track); toast.info('已加入下一首播放'); dismiss() }} />
      <MenuItem icon={ListPlus} label="加入队列" onClick={() => { addToQueue(track); toast.info('已加入播放队列'); dismiss() }} />
      <MenuItem
        icon={Heart}
        label={isFav ? '取消收藏' : '收藏'}
        onClick={() => {
          void toggleFav(track.uid).then(
            () => toast.success(isFav ? '已取消收藏' : '已收藏'),
            () => toast.error(isFav ? '取消收藏失败，请重试' : '收藏失败，请重试')
          )
          // 显式选择操作不受长按松手的背景关闭保护期限制。
          dismiss()
        }}
      />
      <MenuItem icon={ListMusic} label="加入歌单" onClick={() => { setPlaylistUid(track.uid); dismiss() }} />
      {playlistEntry && (
        <MenuItem icon={ListMinus} label="移出歌单" onClick={() => { void handleRemoveFromPlaylist() }} />
      )}
      {authenticated && (
        <MenuItem
          icon={Download}
          label="下载"
          onClick={() => {
            setDownloadTrack(track)
            dismiss()
          }}
        />
      )}
      <MenuItem icon={Share2} label="分享" onClick={handleShare} />
    </>
  )

  return (
    <>
      {isMobile ? (
        // 手机：底部 action sheet，点遮罩关闭
        <ModalMask className="safe-screen fixed inset-0 z-50 bg-black/50" onClose={close}>
          <div
            ref={menuRef}
            className="safe-area-bottom song-action-sheet absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-xl border-t border-border bg-card p-2 pb-3 shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="menu"
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
            {menuItems}
          </div>
        </ModalMask>
      ) : (
        // 桌面：原 fixed 定位小菜单
        <div
          ref={menuRef}
          className="fixed z-50 w-48 rounded-md border border-border bg-card p-1 shadow-lg"
          style={{ left, top }}
          role="menu"
        >
          {menuItems}
        </div>
      )}
      {playlistDialog}
      {downloadDialog}
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:py-2"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  )
}
