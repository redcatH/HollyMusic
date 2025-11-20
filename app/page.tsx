'use client'

import { useCallback } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { SearchBar } from '@/components/search/SearchBar'
import { MusicList } from '@/components/search/MusicList'
import { useSearch } from '@/hooks/useSearch'
import { useMusicUrl } from '@/hooks/useMusicUrl'
import { usePlayerStore } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { MusicInfo } from '@/lib/types/music'

export default function Home() {
  const { query, setQuery, source, results, loading, error, search, setSource } = useSearch()
  const { getMusicUrl } = useMusicUrl()
  const { setCurrentMusic, setPlaylist, setIsPlaying } = usePlayerStore()

  const handleSearch = (keyword: string) => {
    search(keyword, source)
  }

  const handleSourceChange = (newSource: string) => {
    setSource(newSource)
  }

  const handleSongPlay = useCallback(
    async (song: MusicInfo) => {
      console.log('点击播放歌曲:', song)
      
      // 从 song.types 中选择最后一个（最高质量）
      const quality = song.types?.[song.types.length - 1]?.type || '128k'
      
      console.log('开始请求 URL，传递的数据:', {
        name: song.name,
        singer: song.singer,
        source: song.source,
        songmid: song.songmid,
        quality,
      })
      
      const musicUrl = await getMusicUrl(song, quality)
      console.log('获取到的 URL:', musicUrl)

      if (!musicUrl) {
        console.error('无法获取音乐 URL')
        toast.error(`请切换源或选择其他歌曲,无法播放 "${song.name}" - ${song.singer} `)
        return
      }

      // 设置当前歌曲和播放列表
      setCurrentMusic({
        id: song.songmid,
        name: song.name,
        artist: song.singer,
        album: song.albumName || '',
        duration: song.interval ? parseInt(song.interval) : 0,
        cover: song.img || undefined,
        source: song.source,
        originUrl: musicUrl,
      })

      setPlaylist([{
        id: song.songmid,
        name: song.name,
        artist: song.singer,
        album: song.albumName || '',
        duration: song.interval ? parseInt(song.interval) : 0,
        cover: song.img || undefined,
        source: song.source,
        originUrl: musicUrl,
      }])
      setIsPlaying(true)
    },
    [getMusicUrl, setCurrentMusic, setPlaylist, setIsPlaying]
  )

  const songs = results?.data?.list || []

  return (
    <MainLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* 搜索区域 */}
        <div>
          <h1 className="text-3xl font-bold mb-4">发现音乐</h1>
          <SearchBar
            value={query}
            onChange={setQuery}
            onSearch={handleSearch}
            loading={loading}
            selectedSource={source}
            onSourceChange={handleSourceChange}
          />
        </div>

        {/* 搜索结果 */}
        {query && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold">
                搜索结果
              </h2>
              {results?.data?.total && (
                <span className="text-sm text-gray-500">
                  ({results.data.total} 首歌曲)
                </span>
              )}
            </div>
            <div className="w-full max-w-full overflow-x-hidden">
              <MusicList
                songs={songs}
                loading={loading}
                error={error}
                onSongPlay={handleSongPlay}
                onSongAddToPlaylist={handleSongPlay}
                onSongFavorite={(song) => {
                  console.log('收藏:', song)
                }}
              />
            </div>
          </div>
        )}

        {/* 默认内容 */}
        {!query && (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <div className="rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 p-3 md:p-6 h-32 md:h-48 flex items-end text-white cursor-pointer hover:shadow-lg transition-shadow">
              <div>
                <p className="text-xs md:text-sm opacity-75">浏览</p>
                <h3 className="text-base md:text-xl font-bold">热门歌曲</h3>
              </div>
            </div>
            <div className="rounded-lg bg-gradient-to-br from-pink-500 to-orange-500 p-3 md:p-6 h-32 md:h-48 flex items-end text-white cursor-pointer hover:shadow-lg transition-shadow">
              <div>
                <p className="text-xs md:text-sm opacity-75">浏览</p>
                <h3 className="text-base md:text-xl font-bold">推荐歌单</h3>
              </div>
            </div>
            <div className="rounded-lg bg-gradient-to-br from-green-500 to-teal-500 p-3 md:p-6 h-32 md:h-48 flex items-end text-white cursor-pointer hover:shadow-lg transition-shadow">
              <div>
                <p className="text-xs md:text-sm opacity-75">浏览</p>
                <h3 className="text-base md:text-xl font-bold">新歌速递</h3>
              </div>
            </div>
            <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 p-3 md:p-6 h-32 md:h-48 flex items-end text-white cursor-pointer hover:shadow-lg transition-shadow">
              <div>
                <p className="text-xs md:text-sm opacity-75">浏览</p>
                <h3 className="text-base md:text-xl font-bold">排行榜</h3>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  )
}
