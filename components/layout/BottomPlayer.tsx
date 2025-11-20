'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ChevronDown, Volume2, VolumeX } from 'lucide-react'
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
  } = usePlayerStore()

  const audio = useAudio(undefined, { volume: 0.7 })
  const [showPlaylist, setShowPlaylist] = useState(false)

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

    audio.load(currentMusicUrl, false).then(() => {
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
  }, [currentMusicUrl, isFetchingUrl, isPlaying])

  // 当前歌曲索引
  const currentIndex = useMemo(() => {
    if (!currentMusic || playlist.length === 0) return -1
    return playlist.findIndex(
      (s) => s.id === currentMusic.id && s.source === currentMusic.source
    )
  }, [currentMusic, playlist])

  // 处理播放/暂停
  const handlePlayPause = useCallback(() => {
    if (!currentMusic) return
    setIsPlaying(!isPlaying)
  }, [currentMusic, isPlaying, setIsPlaying])

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
  const handleSelectSong = (songId: string, index: number) => {
    const song = playlist[index]
    if (song) {
      usePlayerStore.setState({ 
        currentMusic: song
      })
      // 不要直接调用 audio.play()，通过 setIsPlaying 来控制
      // 这样会触发第二个 effect，自动同步到 audio
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
