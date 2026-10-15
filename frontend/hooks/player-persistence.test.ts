import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAuthStore } from '@/hooks/useAuth'
import { startPlayerSession, syncPlayerPreferences } from '@/lib/player-persistence'
import { DEFAULT_PLAYER_PREFERENCES, PLAYER_PREFERENCES_KEY, loadPlayerPreferences, playbackSessionStorage, playerTabStorage } from '@/lib/player-storage'
import { toTrack } from '@/lib/types/player'

vi.mock('@/lib/api/history', () => ({ reportPlay: vi.fn(async () => {}) }))

const track = (id: string) => toTrack({ uid: `kw-${id}`, musicInfo: {
  name: id, singer: 'artist', source: 'kw', songmid: id, interval: '03:00', types: [],
  _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: { '320k': 'https://expired.example/audio' },
} })
const first = track('first')
const second = track('second')
const extra = track('extra')
const snapshot = { queue: [first, second], playNextQueue: [extra], currentTrack: first,
  currentIndex: 0, isCurrentTempPlay: false, currentTime: 92 }
let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  usePlayerStore.getState().clearSleepTimer()
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), ...DEFAULT_PLAYER_PREFERENCES }, true)
  useAuthStore.setState({ authenticated: false, username: null })
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  stop?.()
  stop = undefined
  usePlayerStore.getState().clearSleepTimer()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('播放器偏好', () => {
  it('刷新读取音量、静音、播放模式、音质，零音量不会被默认值覆盖', () => {
    const player = usePlayerStore.getState()
    player.setVolume(0)
    player.toggleMute()
    player.cyclePlaybackMode()
    player.setQuality('flac')
    expect(loadPlayerPreferences()).toEqual({ volume: 0, isMuted: true, playbackMode: 'loop', quality: 'flac' })
  })

  it('迁移旧音质偏好，只在成功保存后移除旧键', () => {
    localStorage.setItem('player:quality', 'flac24bit')
    expect(loadPlayerPreferences().quality).toBe('flac24bit')
    expect(localStorage.getItem('player:quality')).toBeNull()
    expect(loadPlayerPreferences().quality).toBe('flac24bit')
  })

  it('损坏 JSON、未知版本及非法字段安全回退', () => {
    localStorage.setItem(PLAYER_PREFERENCES_KEY, '{broken')
    expect(loadPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES)
    localStorage.setItem(PLAYER_PREFERENCES_KEY, JSON.stringify({ version: 999, data: { volume: 0.1 } }))
    expect(loadPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES)
    localStorage.setItem(PLAYER_PREFERENCES_KEY, JSON.stringify({ version: 1, data: { volume: -1, quality: 'invalid', isMuted: 'false' } }))
    expect(loadPlayerPreferences()).toEqual({ ...DEFAULT_PLAYER_PREFERENCES, volume: 0 })
  })

  it('浏览器拒绝读写时仍可调整音量、音质和播放', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(loadPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES)
    stop = startPlayerSession('alice')
    usePlayerStore.getState().setVolume(0.2)
    usePlayerStore.getState().setQuality('128k')
    await usePlayerStore.getState().playTrack(first)
    window.dispatchEvent(new Event('pagehide'))
    expect(usePlayerStore.getState()).toMatchObject({ volume: 0.2, quality: '128k', isPlaying: true })
  })

  it('其他标签页仅同步偏好，不改变歌曲与队列', async () => {
    stop = syncPlayerPreferences()
    await usePlayerStore.getState().playTrack(first)
    localStorage.setItem(PLAYER_PREFERENCES_KEY, JSON.stringify({ version: 1, data: { volume: 0.15, isMuted: true, quality: '128k' } }))
    window.dispatchEvent(new StorageEvent('storage', { key: PLAYER_PREFERENCES_KEY, storageArea: localStorage }))
    expect(usePlayerStore.getState()).toMatchObject({ volume: 0.15, isMuted: true, currentTrack: first, isPlaying: true })
  })
})

describe('播放会话', () => {
  it('刷新恢复歌曲、进度与两种队列，默认暂停且不加载播放地址', () => {
    playbackSessionStorage('alice').write(snapshot)
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: { uid: first.uid }, currentTime: 92,
      currentIndex: 0, isPlaying: false, streamUrl: null })
    expect(usePlayerStore.getState().queue.map(t => t.uid)).toEqual([first.uid, second.uid])
    expect(usePlayerStore.getState().playNextQueue.map(t => t.uid)).toEqual([extra.uid])
    usePlayerStore.getState().togglePlay()
    expect(usePlayerStore.getState()).toMatchObject({ currentTime: 92, isPlaying: true })
    expect(usePlayerStore.getState().streamUrl).toContain('kw-first')
  })

  it('刷新保留重复入队与插播状态，插播结束后回到主队列游标', () => {
    playbackSessionStorage('alice').write({ ...snapshot, currentTrack: extra, isCurrentTempPlay: true,
      playNextQueue: [extra, extra] })
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState().playNextQueue).toHaveLength(2)
    usePlayerStore.getState().next()
    usePlayerStore.getState().next()
    usePlayerStore.getState().next()
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: { uid: second.uid }, currentIndex: 1, isCurrentTempPlay: false })
  })

  it('进度节流保存，页面隐藏和暂停时补存，不保存瞬时字段与直链', async () => {
    stop = startPlayerSession('alice')
    await usePlayerStore.getState().playTrack(first)
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    for (let i = 1; i <= 100; i++) usePlayerStore.getState().setCurrentTime(i / 10)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(playbackSessionStorage('alice').read()?.currentTime).toBe(10)
    usePlayerStore.getState().setCurrentTime(12)
    window.dispatchEvent(new Event('pagehide'))
    expect(playbackSessionStorage('alice').read()?.currentTime).toBe(12)
    usePlayerStore.getState().setCurrentTime(14)
    usePlayerStore.getState().setIsPlaying(false)
    const raw = localStorage.getItem(playbackSessionStorage('alice').key)!
    expect(raw).not.toMatch(/streamUrl|isPlaying|bufferProgress|expired\.example/)
    expect(playbackSessionStorage('alice').read()?.currentTime).toBe(14)
  })

  it('切换账号不串队列，退出后的清空不会覆盖旧账号记录', () => {
    playbackSessionStorage('alice').write(snapshot)
    stop = startPlayerSession('alice')
    usePlayerStore.getState().setCurrentTime(100)
    stop()
    usePlayerStore.getState().clearQueue()
    stop = startPlayerSession('bob')
    expect(usePlayerStore.getState().currentTrack).toBeNull()
    stop()
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState().currentTime).toBe(100)
    expect(usePlayerStore.getState().currentTrack?.uid).toBe(first.uid)
  })

  it('同标签页刷新优先使用自己的副本，空闲关闭不覆盖其他标签页', () => {
    playbackSessionStorage('alice').write(snapshot)
    stop = startPlayerSession('alice')
    playbackSessionStorage('alice').write({ ...snapshot, currentTime: 150 })
    stop()
    expect(playbackSessionStorage('alice').read()?.currentTime).toBe(150)
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState().currentTime).toBe(92)
  })

  it('主动清空队列后刷新不会复活旧歌曲', () => {
    playbackSessionStorage('alice').write(snapshot)
    stop = startPlayerSession('alice')
    usePlayerStore.getState().clearQueue()
    stop()
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState().currentTrack).toBeNull()
    expect(usePlayerStore.getState().queue).toEqual([])
  })

  it('损坏的曲目不能令索引错位，过大进度限制在时长内', () => {
    const storage = playbackSessionStorage('alice')
    localStorage.setItem(storage.key, JSON.stringify({ version: 1, data: { ...snapshot, queue: [null, second] } }))
    expect(storage.read()).toBeNull()
    storage.write({ ...snapshot, currentTime: 99999 })
    expect(storage.read()?.currentTime).toBe(180)
  })
})

describe('睡眠定时器与面板', () => {
  it('刷新按截止时间恢复，并在剩余时间结束时暂停', () => {
    playbackSessionStorage('alice').write(snapshot)
    playerTabStorage('alice').write({ sleepTimer: { minutes: 15, expiresAt: Date.now() + 8000 }, isQueueOpen: true, isLyricsOpen: true })
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState()).toMatchObject({ isQueueOpen: true, isLyricsOpen: true })
    usePlayerStore.getState().togglePlay()
    vi.advanceTimersByTime(7999)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    vi.advanceTimersByTime(1)
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, sleepTimer: null })
  })

  it('已过期定时器不会重新计时，新标签页不继承旧定时器', () => {
    const settings = playerTabStorage('alice')
    sessionStorage.setItem(settings.key, JSON.stringify({ version: 1, data: { sleepTimer: { minutes: 15, expiresAt: Date.now() - 1 } } }))
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState().sleepTimer).toBeNull()
    usePlayerStore.getState().cycleSleepTimer()
    stop()
    sessionStorage.clear()
    stop = startPlayerSession('alice')
    expect(usePlayerStore.getState().sleepTimer).toBeNull()
  })
})
