/**
 * SPA 根布局。
 *
 * 替代 Next.js app-router 的 app/layout.tsx + AppShell.tsx。
 * react-router 的 navigate() 同步更新 URL，组件立即切换——无需 pendingPath/activePath。
 */

import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar, MobileSidebar } from './components/Layout'
import { MobileHeader } from './components/MobileHeader'
import { ServiceWorkerRegister } from './components/ServiceWorkerRegister'
import { PlayerBar } from '@/components/player/PlayerBar'
import { QueuePanel } from '@/components/player/QueuePanel'
import { LyricsPanel } from '@/components/player/LyricsPanel'
import { ToastContainer } from '@/components/toast/ToastContainer'
import { SongContextMenu } from '@/components/shared/SongContextMenu'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { usePlayerStore } from '@/lib/store/player-store'
import { useSearchStore } from '@/lib/store/search-store'
import { useAuthStore } from '@/hooks/useAuth'
import { HomePage } from './routes/HomePage'
import { DiscoveryCollectionPage } from './routes/DiscoveryCollectionPage'
import { RecommendedMusicPage } from './routes/RecommendedMusicPage'
import { SearchPage } from './routes/SearchPage'
import { FavoritesPage } from './routes/FavoritesPage'
import { PlaylistsPage } from './routes/PlaylistsPage'
import { PlaylistDetailPage } from './routes/PlaylistDetailPage'
import { AiPlaylistPage } from './routes/AiPlaylistPage'
import { HistoryPage } from './routes/HistoryPage'
import { LoginPage } from './routes/LoginPage'
import { ChangePasswordPage } from './routes/ChangePasswordPage'
import { AdminPage, AdminUsersPage, AdminSourcesPage, AdminRecommendPage } from './routes/AdminPage'

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const initAuth = useAuthStore(s => s.init)
  const authenticated = useAuthStore(s => s.authenticated)
  const mustChangePassword = useAuthStore(s => s.mustChangePassword)
  const loadFavorites = useFavoritesStore(s => s.load)
  const playByUid = usePlayerStore(s => s.playByUid)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 播放引擎只创建一张原生 Audio；传给底栏与歌词详情共用同一分析对象。
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)

  // 启动时获取会话状态
  useEffect(() => {
    initAuth()
  }, [initAuth])

  // 登录后才加载收藏
  useEffect(() => {
    if (authenticated === true) {
      loadFavorites()
    }
  }, [authenticated, loadFavorites])

  // 登出/会话失效 → 清空上一个用户的播放器、收藏、搜索等残留状态
  useEffect(() => {
    if (authenticated !== false) return
    const p = usePlayerStore.getState()
    p.clearQueue()       // 队列/当前曲目/streamUrl/isPlaying（停声音 + 清 MediaSession）
    p.clearSleepTimer()  // 上一个用户的睡眠定时器
    useFavoritesStore.getState().reset()
    useSearchStore.getState().reset()
  }, [authenticated])

  // 分享链接 ?uid= 自动播放 / ?playlist= 跳歌单详情（各只触发一次）。
  // 等登录完成后由 location 驱动：未登录时守卫会先拦去登录页（携带 redirect），
  // 登录回跳后 location 变化，在此接续——提前触发只会静默 401，且 ref 置位会导致回跳后不再播放。
  const autoPlayRef = useRef(false)
  const playlistRef = useRef(false)
  useEffect(() => {
    if (authenticated !== true) return
    const params = new URLSearchParams(location.search)
    const uid = params.get('uid')
    if (uid && !autoPlayRef.current) {
      autoPlayRef.current = true
      void playByUid(uid).catch(() => {})
    }
    const pid = params.get('playlist')
    if (pid && !playlistRef.current) {
      playlistRef.current = true
      navigate(`/playlists/${pid}`, { replace: true })
    }
  }, [authenticated, location, playByUid, navigate])

  // 全局路由守卫：除登录页外，所有页面都必须有有效会话。
  // 携带原地址（含查询参数）作为 redirect，登录成功后回到来源页（分享链接 ?uid=/?playlist= 场景）。
  useEffect(() => {
    if (authenticated === null) return
    if (authenticated === false && location.pathname !== '/login') {
      const from = location.pathname + location.search
      navigate(`/login?redirect=${encodeURIComponent(from)}`, { replace: true })
    }
  }, [authenticated, location.pathname, location.search, navigate])

  // 强制改密守卫：已登录但 mustChangePassword=true 时，除改密页外一律拦截到改密页
  useEffect(() => {
    if (authenticated !== true || !mustChangePassword) return
    if (location.pathname === '/change-password') return
    navigate('/change-password', { replace: true })
  }, [authenticated, mustChangePassword, location.pathname, navigate])

  // 路由切换 → 关闭抽屉
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // 抽屉打开时：ESC 关闭 + 锁定 body 滚动
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  // 登录页无需已有会话；其余路由在校验完成前不渲染业务内容，避免未登录闪屏。
  if (location.pathname === '/login') {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </div>
    )
  }

  if (authenticated === null) return <div className="min-h-screen bg-background" />
  if (authenticated === false) return null
  if (mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />

  // 改密页同样必须已登录，但保持独立全屏布局。
  if (location.pathname === '/change-password') {
    return <div className="min-h-screen bg-background text-foreground"><ChangePasswordPage /></div>
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ServiceWorkerRegister />
      <MobileHeader onMenuClick={() => setDrawerOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/recommend" element={<RecommendedMusicPage />} />
            <Route path="/discover/toplists/:id" element={<DiscoveryCollectionPage kind="toplists" />} />
            <Route path="/discover/playlists/:id" element={<DiscoveryCollectionPage kind="playlists" />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/ai-create" element={<AiPlaylistPage />} />
            <Route path="/playlists/:id/ai-add" element={<AiPlaylistPage />} />
            <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/sources" element={<AdminSourcesPage />} />
            <Route path="/admin/recommend" element={<AdminRecommendPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <PlayerBar audio={audioElement} onAudioElement={setAudioElement} />
      <MobileSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <QueuePanel />
      <LyricsPanel audio={audioElement} />
      <SongContextMenu />
      <ToastContainer />
    </div>
  )
}
