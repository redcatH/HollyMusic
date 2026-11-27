/* global holly */
'use strict'

const PC = 'https://api.qishui.com/luna/pc/'
const VEHICLE = 'https://api-vehicle.volcengine.com/v2/search/type'
const RADIO = 'https://beta-luna.douyin.com/luna/'
const WEB_PARAMS = { aid: '386088', device_platform: 'web', channel: 'pc_web' }
const CATEGORIES = [[0, '推荐'], [14, '流行'], [8, '华语'], [15, '摇滚'], [69, '治愈']]
const CHARTS = [{ id: '7036274230471712007', name: '热歌榜' }]
const QUALITIES = { medium: '128k', highest: '320k', lossless: 'flac', hi_res: 'flac24bit' }

function url(base, params) {
  const query = Object.entries(params).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
  return query ? `${base}?${query}` : base
}

function completeCoverUrl(value) {
  return typeof value === 'string' && /^https:\/\/[^/?#]+\/[^?#]*[^/?#](?:[?#].*)?$/.test(value) ? value : ''
}

function cover(value) {
  if (!value || typeof value !== 'object') return completeCoverUrl(value)
  const urls = Array.isArray(value.urls) ? value.urls : []
  const alternateUrls = Array.isArray(value.url_list) ? value.url_list : []
  const candidates = [...urls, ...alternateUrls, value.url]
  const direct = candidates.map(completeCoverUrl).find(Boolean)
  if (direct) return direct

  const { uri, template_prefix: template } = value
  const base = candidates.find(candidate => typeof candidate === 'string' && /^https:\/\/[^/?#]+\/img\/$/.test(candidate))
  if (!base || typeof uri !== 'string' || !/^[\w-]+(?:\/[\w.-]+)+$/.test(uri) || uri.split('/').includes('..')
    || typeof template !== 'string' || !/^tplv-[\w-]+$/.test(template)) return ''
  return `${base}${uri}~${template}-resize:480:480.webp`
}

function collection(value) {
  if (typeof value?.id !== 'string' || !(value.title || value.name)) return null
  return { id: value.id, name: value.title || value.name, author: value.owner?.nickname || value.owner?.name || '',
    cover: cover(value.url_cover) || cover(value.cover_url), description: value.desc || '', songCount: value.count_tracks }
}

function song(value) {
  if (typeof value?.id !== 'string' || !/^\d{1,24}$/.test(value.id) || !(value.title || value.name)) return null
  const artists = value.artists ?? (value.author_info ? [value.author_info] : [])
  return { id: value.id, name: value.title || value.name,
    artist: artists.map(item => item.user_info?.name || item.name || item.nickname).filter(Boolean).join('、'),
    album: value.album?.name, albumId: value.album?.id,
    cover: cover(value.album?.url_cover) || cover(value.cover_url), durationMs: value.duration ?? value.duration_ms,
    qualities: (value.bit_rates ?? []).map(item => QUALITIES[item.quality ?? item.Quality]).filter(Boolean) }
}

function unwrap(item) {
  return item.entity?.track_wrapper?.track ?? item.entity?.track ?? item.track ?? item
}

function page(items, nextCursor, more = Boolean(nextCursor), total) {
  return { items: items.filter(Boolean), hasMore: !!more && !!nextCursor, nextCursor, total }
}

async function searchSongs({ keyword, cursor, limit }, { request }) {
  const response = await request(url(VEHICLE, { keyword, search_type: 'music', search_source: 'qishui', limit, search_params: cursor }))
  const data = response?.data
  if (response?.errno !== 0 || !Array.isArray(data?.list)) throw new Error('汽水单曲搜索暂不可用')
  const songs = data.list.filter(item => item.source === 'qishui').slice(0, limit).map(item => song({
    id: item.item_id, title: item.title, author_info: item.author_info, album: { id: item.collection_id, name: item.collection_name },
    cover_url: item.cover_url, duration: Math.round(Number(item.duration) * 1000) || 0,
  }))
  return page(songs, data.search_params, data.has_more)
}

async function searchPlaylists({ keyword, cursor, limit }, { request }) {
  const previous = cursor ? JSON.parse(cursor) : null
  const searchId = previous?.searchId ?? `holly-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const response = await request(url(`${PC}search/playlist`, { ...WEB_PARAMS, q: keyword, cursor: previous?.cursor ?? '0', count: limit,
    search_id: searchId, search_method: 'input', debug_params: '', from_search_id: '', search_scene: '' }))
  if (!Array.isArray(response?.result_groups)) throw new Error('汽水歌单搜索暂不可用')
  const group = response.result_groups.find(item => item.id === 'playlists')
  const next = group?.next_cursor ? JSON.stringify({ searchId, cursor: group.next_cursor }) : undefined
  return page((group?.data ?? []).slice(0, limit).map(item => collection(item.entity?.playlist)), next, group?.has_more === true)
}

function listPlaylistCategories() {
  return page(CATEGORIES.map(([id, name]) => ({ id: String(id), name })))
}

async function listPlaylists({ categoryId, limit }, { request }) {
  const response = await request(url(`${PC}discover/mix`, WEB_PARAMS), { method: 'POST', body: {
    block_type: 'discover_playlist_mix', feed_discover_extra: {}, latest_douyin_liked_playlist_show_ts: 0, sub_channel_id: Number(categoryId ?? 0),
  } })
  if (!Array.isArray(response?.inner_block)) throw new Error('汽水歌单广场暂不可用')
  const items = response.inner_block.flatMap(block => block.resources ?? []).map(item => collection(item.entity?.playlist))
  return page(items.filter(Boolean).slice(0, limit))
}

async function getPlaylist({ id, cursor, limit }, { request }) {
  const response = await request(url(`${PC}playlist/detail`, { ...WEB_PARAMS, playlist_id: id, cursor: cursor ?? '0', count: limit }))
  if (!response?.playlist || !Array.isArray(response.media_resources)) throw new Error('汽水歌单暂不可用')
  const details = collection(response.playlist)
  return { ...page(response.media_resources.slice(0, limit).map(item => song(unwrap(item))), response.next_cursor,
    response.has_more, response.playlist.count_tracks), collection: details }
}

function listCharts({ limit }) { return page(CHARTS.slice(0, limit)) }

async function getChart({ id, cursor, limit }, { request }) {
  const response = await request(url(`${PC}charts/${encodeURIComponent(id)}`, WEB_PARAMS))
  const chart = response?.chart
  if (!Array.isArray(chart?.track_ranks)) throw new Error('汽水榜单暂不可用')
  const start = Number(cursor ?? 0)
  const next = start + limit
  return { ...page(chart.track_ranks.slice(start, next).map(item => song(item.track)), next < chart.track_ranks.length ? String(next) : undefined,
    next < chart.track_ranks.length, chart.track_ranks.length),
    collection: collection({ ...chart, cover_url: chart.style?.bg_url ?? chart.cover_url }) }
}

async function listRadioStations({ limit }, { request }) {
  const response = await request(`${RADIO}discover`, { method: 'POST', body: { first_request: true } })
  if (!Array.isArray(response?.blocks)) throw new Error('汽水漫游暂不可用')
  const stations = response.blocks.flatMap(block => block.inner_block ?? []).filter(item => item.type === 'discover_radio')
    .map(item => {
      const resource = item.resources?.[0]
      return collection({ id: item.inner_block_id || resource?.resource_id, name: item.title, desc: item.desc,
        url_cover: item.url_info, cover_url: resource?.style?.cover_url_list?.[0] ?? resource?.url_info })
    })
  return page(stations.filter(Boolean).slice(0, limit))
}

async function getRadioTracks({ id, cursor, limit }, context) {
  const response = await context.request(`${RADIO}feed/radio/tracks`, { method: 'POST', body: { radio_id: id, count: limit, cursor: cursor ?? '' } })
  if (!Array.isArray(response?.items)) throw new Error('汽水漫游暂不可用')
  const { items } = await listRadioStations({ limit: 100 }, context)
  return { ...page(response.items.slice(0, limit).map(item => song(unwrap(item))), response.next_cursor ?? response.cursor, response.has_more),
    collection: items.find(item => item.id === id) ?? { id, name: '汽水漫游' } }
}

holly.register({
  apiVersion: 1, id: 'holly-qishui', name: '汽水音乐', version: '1.0.1',
  platforms: [{ id: 'qs', name: '汽水音乐', origins: ['https://api.qishui.com', 'https://api-vehicle.volcengine.com', 'https://beta-luna.douyin.com'],
    handlers: { searchSongs, searchPlaylists, listPlaylistCategories, listPlaylists, getPlaylist, listCharts, getChart, listRadioStations, getRadioTracks } }],
})
