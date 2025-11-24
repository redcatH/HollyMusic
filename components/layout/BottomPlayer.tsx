'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ChevronDown, Volume2, VolumeX, Repeat, Shuffle } from 'lucide-react'
import { usePlayerStore } from '@/lib/store'
import { useAudio } from '@/hooks/useAudio'
import { PlayerControls } from '@/components/player/PlayerControls'
import { ProgressBar } from '@/components/player/ProgressBar'
import { PlaylistView } from '@/components/player/PlaylistView'

export function BottomPlayer() {
  const {
    isDarkMode,
    currentMusic,
    currentMusicUrl,
    isFetchingUrl,
    urlFetchError,
    isPlaying,
    setIsPlaying,
    playlist,
    removeFromPlaylist,
    playbackMode,
    cyclePlaybackMode,
  } = usePlayerStore()

  const audio = useAudio(undefined, { volume: 0.7 })
  const [showPlaylist, setShowPlaylist] = useState(false)
  const unlockedRef = useRef(false)

  // 尝试在用户手势下解锁浏览器音频（优先使用 AudioContext，无声播放）
  const tryUnlockAudio = useCallback(async () => {
    if (typeof window === 'undefined' || unlockedRef.current) return

    // safer typed access to window AudioContext
    type WindowAudio = { AudioContext?: any; webkitAudioContext?: any }
    const win = window as unknown as WindowAudio

    try {
      const AudioCtxCtor = win.AudioContext || win.webkitAudioContext
      if (AudioCtxCtor) {
        const ac = new AudioCtxCtor()
        if (ac.state === 'suspended') {
          await ac.resume().catch(() => {})
        }
        try {
          const buffer = ac.createBuffer(1, 1, ac.sampleRate)
          const src = ac.createBufferSource()
          src.buffer = buffer
          src.connect(ac.destination)
          src.start(0)
          src.stop(0)
        } catch {
          // ignore
        }
        unlockedRef.current = true
        return
      }
    } catch {
      // ignore
    }

    // 回退方法：创建一个静音的 HTMLAudio 并 play()，多数浏览器会将其视为用户手势解锁
    try {
      const a = new Audio()
      a.muted = true
      const p = a.play()
      if (p && typeof (p as Promise<unknown>).then === 'function') {
        await (p as Promise<unknown>).catch(() => {})
      }
      try { a.pause() } catch {
        // ignore
      }
      unlockedRef.current = true
    } catch {
      // ignore
    }
  }, [])

  // 当前歌曲索引
  const currentIndex = useMemo(() => {
    if (!currentMusic || playlist.length === 0) return -1
    return playlist.findIndex(
      (s) => s.id === currentMusic.id && s.source === currentMusic.source
    )
  }, [currentMusic, playlist])

  // ✨ 处理歌曲结束（定义在 effect 前面，以便在 effect 中使用）
  const handleSongEnd = useCallback(() => {
    const state = usePlayerStore.getState()
    console.log('BottomPlayer: 歌曲结束，当前播放模式:', state.playbackMode)
    
    if (state.playbackMode === 'loop') {
      // 单曲循环：暂停然后重新播放，或者清空 currentMusicUrl 再重新加载
      console.log('BottomPlayer: 单曲循环，重新加载')
      // 临时清空 URL，然后立即恢复，强制 effect 重新触发
      usePlayerStore.setState({ currentMusicUrl: null }, false)
      setTimeout(() => {
        usePlayerStore.setState({ currentMusicUrl: state.currentMusicUrl }, false)
      }, 0)
    } else if (state.playbackMode === 'sequence') {
      // 顺序播放：播放下一首
      const currentIdx = state.playlist.findIndex(
        (s) => s.id === state.currentMusic?.id && s.source === state.currentMusic?.source
      )
      if (currentIdx >= 0 && currentIdx < state.playlist.length - 1) {
        console.log('BottomPlayer: 顺序播放，切换到下一首')
        usePlayerStore.setState({ currentMusic: state.playlist[currentIdx + 1] })
      }
    } else if (state.playbackMode === 'random') {
      // 随机播放：随机选择一首歌
      if (state.playlist.length > 0) {
        const randomIndex = Math.floor(Math.random() * state.playlist.length)
        console.log('BottomPlayer: 随机播放，切换到索引:', randomIndex)
        usePlayerStore.setState({ currentMusic: state.playlist[randomIndex] })
      }
    }
  }, [])

  // 统一处理 URL 和播放状态变化
  useEffect(() => {
    console.log('BottomPlayer: URL 或加载状态变化', {
      currentMusicUrl,
      isFetchingUrl,
      isPlaying,
    })

    if (!currentMusicUrl) {
      console.log('BottomPlayer: URL 为空，暂停')
      audio.pause()
      return
    }

    // URL 还在获取中，暂停
    if (isFetchingUrl) {
      console.log('BottomPlayer: 正在获取 URL，暂停')
      audio.pause()
      return
    }

    // URL 已准备好，加载音频
    console.log('BottomPlayer: 加载音频', currentMusicUrl)
    let isMounted = true

    audio.load(currentMusicUrl, false, handleSongEnd).then(() => {
      if (!isMounted) return
      console.log('BottomPlayer: 音频加载完成')
      // 加载完成后，根据 isPlaying 决定是否播放
      if (isPlaying) {
        console.log('BottomPlayer: 自动播放')
        audio.play()
      }
    }).catch((err) => {
      if (!isMounted) return
      console.error('BottomPlayer: 音频加载失败', err)
    })

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMusicUrl, isFetchingUrl, isPlaying, handleSongEnd])

  // 处理播放/暂停（先尝试解锁音频）
  const handlePlayPause = useCallback(async () => {
    if (!currentMusic) return
    await tryUnlockAudio()

    // if not loaded yet, load with autoplay. decide whether to use HTML5 based on platform
    const shouldUseHtml5 = ((): boolean => {
      if (typeof navigator === 'undefined') return false
      const ua = navigator.userAgent || ''
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua)
      // Prefer HTML5 on iOS Safari or Android WebView where streaming might be required
      const isSafari = /Version\/\d+.*Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua)
      return isMobile && isSafari
    })()

    // if currently not playing and nothing is loaded (duration 0), load and autoplay with chosen backend
    if (!audio.isPlaying && !audio.isLoading && (!audio.duration || audio.duration === 0) && currentMusicUrl) {
      try {
        await audio.load(currentMusicUrl, true, handleSongEnd, { useHtml5: shouldUseHtml5 })
        setIsPlaying(true)
      } catch (err) {
        console.error('BottomPlayer: 自动加载并播放失败，尝试默认加载', err)
        // fallback: try loading without forcing html5
        try {
          await audio.load(currentMusicUrl, true, handleSongEnd)
          setIsPlaying(true)
        } catch (e) {
          console.error('BottomPlayer: 回退加载也失败', e)
        }
      }
      return
    }

    setIsPlaying(!isPlaying)
  }, [currentMusic, isPlaying, setIsPlaying, tryUnlockAudio, audio, currentMusicUrl, handleSongEnd])

  // 处理上一首
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      usePlayerStore.setState({ currentMusic: playlist[currentIndex - 1] })
    }
  }, [currentIndex, playlist])

  // 处理下一首
  const handleNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
      usePlayerStore.setState({ currentMusic: playlist[currentIndex + 1] })
    }
  }, [currentIndex, playlist])

  // 处理音量
  const handleVolumeChange = (vol: number) => {
    audio.setVolume(vol)
  }

  // 处理选择歌曲
  const handleSelectSong = async (songId: string, index: number) => {
    const song = playlist[index]
    if (song) {
      usePlayerStore.setState({ 
        currentMusic: song
      })
      // 不要直接调用 audio.play()，通过 setIsPlaying 来控制
      // 这样会触发第二个 effect，自动同步到 audio
      await tryUnlockAudio()
      setIsPlaying(true)
    }
  }

  if (!currentMusic) {
    return (
      <div
        className={`fixed bottom-0 left-0 right-0 h-24 border-t flex items-center justify-center z-50 ${
          isDarkMode ? 'border-gray-800 bg-gray-950' : 'border-gray-200 bg-white'
        }`}
      >
        <p className="text-sm text-gray-500">选择一首歌曲开始播放</p>
      </div>
    )
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 border-t transition-all z-50 ${
        isDarkMode ? 'border-gray-800 bg-gray-950' : 'border-gray-200 bg-white'
      } ${showPlaylist ? 'h-96' : 'h-24'}`}
    >
      {/* 进度条 */}
      <div className="px-4 pt-2">
        <ProgressBar
          currentTime={audio.currentTime}
          duration={audio.duration}
          onSeek={audio.seek}
          isLoading={audio.isLoading}
          showTime={true}
        />
      </div>

      {/* 主控制区 */}
      <div className="flex items-center justify-between px-4 py-3 h-16">
        {/* 左侧 - 歌曲信息 / 加载状态 / 错误信息 */}
        <div className="flex-1 min-w-0 mr-4 flex-shrink-0">
          {isFetchingUrl ? (
            // 加载状态
            <div className="flex items-center gap-2">
              <div className="animate-spin">
                <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                加载中...
              </p>
            </div>
          ) : audio.isLoading ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin">
                <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                缓冲中...
              </p>
            </div>
          ) : urlFetchError ? (
            // 错误状态
            <div>
              <p className="text-sm font-medium text-red-500 truncate">
                加载失败
              </p>
              <p className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {urlFetchError}
              </p>
            </div>
          ) : (
            // 正常显示歌曲信息
            <>
              <p
                className={`text-sm font-medium truncate ${
                  isDarkMode ? 'text-white' : 'text-black'
                }`}
              >
                {currentMusic.name}
              </p>
              <p
                className={`text-xs truncate ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                {currentMusic.artist}
              </p>
            </>
          )}
        </div>

        {/* 中央 - 播放控制 */}
        <div className="flex-shrink-0">
          <PlayerControls
            isPlaying={audio.isPlaying}
            onPlay={handlePlayPause}
            onPause={handlePlayPause}
            onPrevious={handlePrevious}
            onNext={handleNext}
            disabled={audio.isLoading || isFetchingUrl || !!urlFetchError}
            hasPrevious={currentIndex > 0}
            hasNext={currentIndex >= 0 && currentIndex < playlist.length - 1}
          />
        </div>

        {/* 右侧 - 音量和播放列表 */}
        <div className="flex items-center gap-4 ml-4 flex-shrink-0">
          {/* 音量控制 */}
          <div className="flex items-center gap-2">
            <button
              onClick={audio.toggleMute}
              className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                audio.isMuted ? 'text-red-500' : ''
              }`}
              title={audio.isMuted ? '取消静音' : '静音'}
            >
              {audio.isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>

            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={audio.isMuted ? 0 : audio.volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-20 hidden sm:block"
              title="音量"
            />
          </div>

          {/* 播放模式按钮 */}
          <div className="relative">
            <button
              onClick={cyclePlaybackMode}
              className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                playbackMode === 'random' ? 'text-blue-500' : 
                playbackMode === 'sequence' ? 'text-purple-500' :
                playbackMode === 'loop' ? 'text-green-500' : ''
              }`}
              title={
                playbackMode === 'loop' ? '单曲循环 (点击切换)' :
                playbackMode === 'sequence' ? '顺序播放 (点击切换)' :
                playbackMode === 'random' ? '随机播放 (点击切换)' : ''
              }
            >
              {playbackMode === 'random' ? (
                <Shuffle className="h-4 w-4" />
              ) : (
                <Repeat className="h-4 w-4" />
              )}
            </button>
            {playbackMode === 'loop' && (
              <span className="absolute -top-1 -right-1 text-xs font-bold text-green-500 bg-white dark:bg-gray-950 rounded-full w-4 h-4 flex items-center justify-center">
                1
              </span>
            )}
          </div>

          {/* 播放列表按钮 */}
          <button
            onClick={() => setShowPlaylist(!showPlaylist)}
            className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
              showPlaylist ? 'text-purple-500' : ''
            }`}
            title="播放列表"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                showPlaylist ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* 播放列表展开 */}
      {showPlaylist && (
        <div
          className={`border-t ${
            isDarkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'
          } p-4 overflow-y-auto max-h-72`}
        >
          <PlaylistView
            onSongSelect={handleSelectSong}
            onRemoveSong={(index) => removeFromPlaylist(index)}
          />
        </div>
      )}
    </div>
  )
}
