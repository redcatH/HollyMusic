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
  usePlayerStore.setState({ isQueueOpen: settings?.isQueueOpen ?? false })
  const snapshot = (): PlaybackSession => {
    const state = usePlayerStore.getState()
    const currentTrack = state.currentTrack ? { ...state.currentTrack, duration: state.duration || state.currentTrack.duration } : null
    const navigation = state.navigation?.current && currentTrack ? {
      ...state.navigation,
      current: { ...state.navigation.current, entry: { ...state.navigation.current.entry, track: currentTrack } },
    } : state.navigation
    return {
      queue: state.queue, playNextQueue: state.playNextQueue, currentIndex: state.currentIndex,
      currentTrack, isCurrentTempPlay: state.isCurrentTempPlay, currentTime: state.currentTime, navigation,
    }
  }
  // 固定本标签页的初始副本，同时将旧版本会话迁移为带导航记录的格式。
  tab.write(snapshot())
  usePlayerStore.setState({ restoredForUsername: username })

  let dirty = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    if (!dirty) return
    const saved = snapshot()
    tab.write(saved)
    local.write(saved)
    dirty = false
  }
  const saveSettings = () => {
    const { sleepTimer, isQueueOpen } = usePlayerStore.getState()
    tabSettings.write({ sleepTimer, isQueueOpen })
  }
  const unsubscribe = usePlayerStore.subscribe((state, previous) => {
    if (state.sleepTimer !== previous.sleepTimer || state.isQueueOpen !== previous.isQueueOpen) saveSettings()
    const structureChanged = state.queue !== previous.queue || state.playNextQueue !== previous.playNextQueue
      || state.currentTrack !== previous.currentTrack || state.currentIndex !== previous.currentIndex
      || state.isCurrentTempPlay !== previous.isCurrentTempPlay || state.navigation !== previous.navigation
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
    usePlayerStore.setState({ restoredForUsername: null })
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
      const preferences = playerPreferencesStorage.read() ?? DEFAULT_PLAYER_PREFERENCES
      usePlayerStore.getState().setPlaybackMode(preferences.playbackMode)
      usePlayerStore.setState({ ...preferences, preferSurround: preferences.preferSurround ?? false })
    } catch { /* 浏览器禁用存储时仍可操作播放器。 */ }
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
