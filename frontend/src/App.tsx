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
import { SearchPage } from './routes/SearchPage'
import { FavoritesPage } from './routes/FavoritesPage'
import { PlaylistsPage } from './routes/PlaylistsPage'
import { PlaylistDetailPage } from './routes/PlaylistDetailPage'
import { AiPlaylistPage } from './routes/AiPlaylistPage'
import { HistoryPage } from './routes/HistoryPage'
import { LoginPage } from './routes/LoginPage'
import { AdminPage, AdminUsersPage, AdminSourcesPage, AdminRecommendPage } from './routes/AdminPage'

const PROTECTED_PREFIXES = ['/favorites', '/playlists', '/history', '/admin', '/search']

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const initAuth = useAuthStore(s => s.init)
  const authenticated = useAuthStore(s => s.authenticated)
  const loadFavorites = useFavoritesStore(s => s.load)
  const playByUid = usePlayerStore(s => s.playByUid)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  // 分享链接 ?uid= 自动播放（仅初始加载触发一次）
  const autoPlayRef = useRef(false)
  useEffect(() => {
    if (autoPlayRef.current) return
    const uid = new URLSearchParams(window.location.search).get('uid')
    if (!uid) return
    autoPlayRef.current = true
    void playByUid(uid).catch(() => {})
  }, [playByUid])

  // 分享链接 ?playlist= 跳转歌单详情（仅初始加载触发一次）
  const playlistRef = useRef(false)
  useEffect(() => {
    if (playlistRef.current) return
    const pid = new URLSearchParams(window.location.search).get('playlist')
    if (!pid) return
    playlistRef.current = true
    navigate(`/playlists/${pid}`, { replace: true })
  }, [navigate])

  // 路由守卫：未登录访问受保护页面 → 跳登录
  useEffect(() => {
    if (authenticated === null) return
    if (authenticated === false) {
      const isProtected = PROTECTED_PREFIXES.some(p => location.pathname.startsWith(p))
      if (isProtected) {
        navigate('/login', { replace: true })
      }
    }
  }, [authenticated, location.pathname, navigate])

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

  // 登录页：独立全屏
  if (location.pathname === '/login') {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </div>
    )
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
            <Route path="/search" element={<SearchPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/ai-create" element={<AiPlaylistPage />} />
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
      <PlayerBar />
      <MobileSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <QueuePanel />
      <LyricsPanel />
      <SongContextMenu />
      <ToastContainer />
    </div>
  )
}
