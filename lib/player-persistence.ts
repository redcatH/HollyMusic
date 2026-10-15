import { usePlayerStore } from '@/lib/store/player-store'
import {
  DEFAULT_PLAYER_PREFERENCES, PLAYER_PREFERENCES_KEY, playerPreferencesStorage,
  playbackSessionStorage, playerTabStorage, type PlaybackSession,
} from '@/lib/player-storage'

const PROGRESS_SAVE_INTERVAL_MS = 5000

/** 每个标签页保存自己的播放位置；本地副本只用于新标签页/重新打开浏览器。 */
export function startPlayerSession(username: string): () => void {
  const local = playbackSessionStorage(username)
  const tab = playbackSessionStorage(username, 'session')
  const tabSettings = playerTabStorage(username)
  const session = tab.read() ?? local.read()
  usePlayerStore.getState().restorePlayback(session)
  const settings = tabSettings.read()
  usePlayerStore.getState().setSleepTimer(settings?.sleepTimer ?? null)
  usePlayerStore.setState({ isQueueOpen: settings?.isQueueOpen ?? false,
    isLyricsOpen: !!session?.currentTrack && (settings?.isLyricsOpen ?? false) })
  // 固定本标签页的初始副本，不让其他标签页之后的写入影响刷新恢复。
  tab.write(session ?? { queue: [], playNextQueue: [], currentTrack: null, currentIndex: -1, isCurrentTempPlay: false, currentTime: 0 })

  let dirty = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    if (!dirty) return
    const state = usePlayerStore.getState()
    const snapshot: PlaybackSession = {
      queue: state.queue, playNextQueue: state.playNextQueue, currentIndex: state.currentIndex,
      currentTrack: state.currentTrack ? { ...state.currentTrack, duration: state.duration || state.currentTrack.duration } : null,
      isCurrentTempPlay: state.isCurrentTempPlay, currentTime: state.currentTime,
    }
    tab.write(snapshot)
    local.write(snapshot)
    dirty = false
  }
  const saveSettings = () => {
    const { sleepTimer, isQueueOpen, isLyricsOpen } = usePlayerStore.getState()
    tabSettings.write({ sleepTimer, isQueueOpen, isLyricsOpen })
  }
  const unsubscribe = usePlayerStore.subscribe((state, previous) => {
    if (state.sleepTimer !== previous.sleepTimer || state.isQueueOpen !== previous.isQueueOpen
      || state.isLyricsOpen !== previous.isLyricsOpen) saveSettings()
    const structureChanged = state.queue !== previous.queue || state.playNextQueue !== previous.playNextQueue
      || state.currentTrack !== previous.currentTrack || state.currentIndex !== previous.currentIndex
      || state.isCurrentTempPlay !== previous.isCurrentTempPlay
    if (structureChanged || state.currentTime !== previous.currentTime || state.duration !== previous.duration) dirty = true
    if (structureChanged || (previous.isPlaying && !state.isPlaying) || state.seekNonce !== previous.seekNonce) save()
    else if (dirty && saveTimer === null) saveTimer = setTimeout(save, PROGRESS_SAVE_INTERVAL_MS)
  })
  const onVisibility = () => {
    const timer = usePlayerStore.getState().sleepTimer
    if (timer && timer.expiresAt <= Date.now()) usePlayerStore.getState().setSleepTimer(timer)
    if (document.hidden) save()
  }
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    save()
    unsubscribe()
    window.removeEventListener('pagehide', save)
    document.removeEventListener('visibilitychange', onVisibility)
    // 退出/切换账号后不再保留旧账号的定时任务。
    usePlayerStore.getState().clearSleepTimer()
  }
}

/** 仅同步设备偏好；队列和进度不订阅跨标签页更新。 */
export function syncPlayerPreferences(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PLAYER_PREFERENCES_KEY && event.key !== null) return
    try {
      if (event.storageArea !== window.localStorage) return
      usePlayerStore.setState(playerPreferencesStorage.read() ?? DEFAULT_PLAYER_PREFERENCES)
    } catch { /* 浏览器禁用存储时仍可操作播放器。 */ }
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
