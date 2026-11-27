/* global holly */
'use strict'

// This fixture is intentionally offline. It demonstrates the plugin contract
// without calling a real platform or bundling a third-party adapter.
const SONGS = [
  { id: 'demo-song-1', name: '示例歌曲一', artist: '示例歌手', album: '示例专辑', durationMs: 180000, cover: 'https://example.com/demo-song-1.webp' },
  { id: 'demo-song-2', name: '示例歌曲二', artist: '示例歌手', album: '示例专辑', durationMs: 210000, cover: 'https://example.com/demo-song-2.webp' },
]
const PLAYLISTS = [
  { id: 'demo-playlist-1', name: '示例歌单', author: 'Holly Music', description: '用于测试平台插件的本地歌单', cover: 'https://example.com/demo-playlist.webp', songCount: SONGS.length },
]
const CATEGORIES = [{ id: 'recommended', name: '推荐' }, { id: 'favorites', name: '收藏' }]
const CHARTS = [{ id: 'demo-chart-1', name: '示例榜单', author: 'Holly Music', cover: 'https://example.com/demo-chart.webp', songCount: SONGS.length }]
const RADIOS = [{ id: 'demo-radio-1', name: '示例漫游', author: 'Holly Music', cover: 'https://example.com/demo-radio.webp' }]

function page(items, cursor, limit) {
  const start = Number(cursor || 0)
  const next = start + limit < items.length ? String(start + limit) : undefined
  return { items: items.slice(start, start + limit), hasMore: Boolean(next), nextCursor: next, total: items.length }
}

function searchSongs({ keyword, cursor, limit }) {
  const items = SONGS.filter(song => !keyword || song.name.includes(keyword))
  return page(items, cursor, limit)
}

function searchPlaylists({ keyword, cursor, limit }) {
  const items = PLAYLISTS.filter(playlist => !keyword || playlist.name.includes(keyword))
  return page(items, cursor, limit)
}

function listPlaylistCategories() {
  return { items: CATEGORIES, hasMore: false }
}

function listPlaylists({ limit, categoryId }) {
  return page(categoryId === 'favorites' ? [] : PLAYLISTS, undefined, limit)
}

function getPlaylist({ id, cursor, limit }) {
  const collection = PLAYLISTS.find(item => item.id === id)
  if (!collection) throw new Error('示例歌单不存在')
  return { ...page(SONGS, cursor, limit), collection }
}

function listCharts({ limit }) {
  return page(CHARTS, undefined, limit)
}

function getChart({ id, cursor, limit }) {
  const collection = CHARTS.find(item => item.id === id)
  if (!collection) throw new Error('示例榜单不存在')
  return { ...page(SONGS, cursor, limit), collection }
}

function listRadioStations({ limit }) {
  return page(RADIOS, undefined, limit)
}

function getRadioTracks({ id, cursor, limit }) {
  const collection = RADIOS.find(item => item.id === id)
  if (!collection) throw new Error('示例漫游不存在')
  return { ...page(SONGS, cursor, limit), collection }
}

holly.register({
  apiVersion: 1,
  id: 'holly-demo-catalog',
  name: '目录插件示例',
  version: '1.0.0',
  platforms: [{
    id: 'demo',
    name: '演示平台',
    origins: [],
    handlers: { searchSongs, searchPlaylists, listPlaylistCategories, listPlaylists, getPlaylist, listCharts, getChart, listRadioStations, getRadioTracks },
  }],
})
