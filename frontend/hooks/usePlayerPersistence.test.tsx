import { act, StrictMode, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/hooks/useAuth'
import { usePlayerPersistence } from '@/hooks/usePlayerPersistence'
import { playbackSessionStorage } from '@/lib/player-storage'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'

const track = toTrack({ uid: 'kw-song', musicInfo: { name: 'song', singer: 'artist', source: 'kw', songmid: 'song', interval: '3:00',
  types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {} } })
const snapshot = { queue: [track], playNextQueue: [], currentIndex: 0, currentTrack: track, currentTime: 42, isCurrentTempPlay: false }
let root: Root

function TestApp() {
  const authenticated = useAuthStore(s => s.authenticated)
  usePlayerPersistence()
  // 与 App 相同的退出清理顺序。
  useEffect(() => { if (authenticated === false) usePlayerStore.getState().clearQueue() }, [authenticated])
  return null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState({ authenticated: null, username: null })
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  vi.unstubAllGlobals()
})

it('登录确认后才恢复，登出先保存再清空，下一账号不继承记录', async () => {
  playbackSessionStorage('alice').write(snapshot)
  await act(async () => { root.render(<StrictMode><TestApp /></StrictMode>) })
  expect(usePlayerStore.getState().currentTrack).toBeNull()
  await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice' }) })
  expect(usePlayerStore.getState().currentTime).toBe(42)
  await act(async () => {
    usePlayerStore.getState().setCurrentTime(70)
    useAuthStore.setState({ authenticated: false, username: null })
  })
  expect(usePlayerStore.getState().currentTrack).toBeNull()
  expect(playbackSessionStorage('alice').read()?.currentTime).toBe(70)
  await act(async () => { useAuthStore.setState({ authenticated: true, username: 'bob' }) })
  expect(usePlayerStore.getState().currentTrack).toBeNull()
  await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice' }) })
  expect(usePlayerStore.getState().currentTime).toBe(70)
})

it('已登录首屏的 StrictMode 重建保留原记录', async () => {
  playbackSessionStorage('alice').write(snapshot)
  useAuthStore.setState({ authenticated: true, username: 'alice' })
  await act(async () => { root.render(<StrictMode><TestApp /></StrictMode>) })
  expect(usePlayerStore.getState()).toMatchObject({ currentTime: 42, isPlaying: false, currentTrack: { uid: track.uid } })
  expect(playbackSessionStorage('alice').read()?.currentTime).toBe(42)
})
