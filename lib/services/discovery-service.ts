import { searchCache } from '@/lib/cache-manager'
import { getStorageSongmidForMusicInfo, upsertMusicInfo } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { MusicInfo, QualityInfo, QualityType, Song } from '@/lib/types/music'

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_SINGLE_SONG_URL = 'https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg'
const CACHE_TTL = 10 * 60 * 1000
const REQUEST_TIMEOUT = 8_000

export interface DiscoveryToplist {
  id: string
  name: string
  description: string
  cover: string
  updateTime?: string
  source: DiscoverySource
}

export interface DiscoveryPlaylist {
  id: string
  name: string
  author: string
  description: string
  cover: string
  playCount: number
  /** 音源列表直接返回的曲目数；未返回时保持为空，避免把未知数显示成 0。 */
  songCount?: number
  source: DiscoverySource
}

export type DiscoveryPlaylistSort = 'recommend' | 'hot' | 'new' | 'collect' | 'soar'
export interface DiscoveryPlaylistFilter { tag?: string; sort?: DiscoveryPlaylistSort; keyword?: string }

/** 发现页支持的音乐平台。 */
export type DiscoverySource = 'tx' | 'wy' | 'kw' | 'kg' | 'mg'

export function isDiscoverySource(value: string | null): value is DiscoverySource {
  return value === 'tx' || value === 'wy' || value === 'kw' || value === 'kg' || value === 'mg'
}

export interface DiscoveryCollectionDetail {
  id: string
  name: string
  description: string
  cover: string
  author: string
  updateTime?: string
  tracks: Song[]
}

type QQSinger = { name?: string }
type QQFile = {
  media_mid?: string
  size_128mp3?: number
  size_320mp3?: number
  size_flac?: number
  size_hires?: number
}
type QQSong = {
  id?: number
  mid?: string
  name?: string
  title?: string
  singer?: QQSinger[]
  album?: { mid?: string; name?: string }
  interval?: number
  file?: QQFile
}
type PlaylistRecord = DiscoveryPlaylist & { songIds: number[] }

// 与 lxserver 的 tx/leaderboard.js 保持同一批常用榜单；列表固定可用，详情实时请求。
const TX_TOPLISTS: DiscoveryToplist[] = [
  { id: '4', name: '流行指数榜', description: 'QQ 音乐流行指数', cover: '', source: 'tx' },
  { id: '26', name: '热歌榜', description: '每日更新的站内热度歌曲', cover: '', source: 'tx' },
  { id: '27', name: '新歌榜', description: '近期热门新歌', cover: '', source: 'tx' },
  { id: '62', name: '飙升榜', description: '热度增长最快的歌曲', cover: '', source: 'tx' },
  { id: '58', name: '说唱榜', description: '说唱音乐精选', cover: '', source: 'tx' },
  { id: '5', name: '内地榜', description: '内地流行音乐', cover: '', source: 'tx' },
  { id: '3', name: '欧美榜', description: '欧美热门音乐', cover: '', source: 'tx' },
  { id: '16', name: '韩国榜', description: '韩国热门音乐', cover: '', source: 'tx' },
]

const WY_TOPLISTS: DiscoveryToplist[] = [
  { id: '19723756', name: '飙升榜', description: '网易云音乐飙升榜', cover: '', source: 'wy' },
  { id: '3779629', name: '新歌榜', description: '网易云音乐新歌榜', cover: '', source: 'wy' },
  { id: '3778678', name: '热歌榜', description: '网易云音乐热歌榜', cover: '', source: 'wy' },
  { id: '2884035', name: '原创榜', description: '网易云音乐原创榜', cover: '', source: 'wy' },
]

const KW_TOPLISTS: DiscoveryToplist[] = [
  { id: '16', name: '热歌榜', description: '酷我热歌榜', cover: '', source: 'kw' },
  { id: '17', name: '新歌榜', description: '酷我新歌榜', cover: '', source: 'kw' },
  { id: '93', name: '飙升榜', description: '酷我飙升榜', cover: '', source: 'kw' },
  { id: '158', name: '抖音热歌榜', description: '酷我抖音热歌榜', cover: '', source: 'kw' },
]

// 与 lxserver 的 kg/leaderboard.js、mg/leaderboard.js 保持同一批常用榜单。
const KG_TOPLISTS: DiscoveryToplist[] = [
  { id: '8888', name: 'TOP500', description: '酷狗音乐 TOP500', cover: '', source: 'kg' },
  { id: '6666', name: '飙升榜', description: '酷狗热度增长最快歌曲', cover: '', source: 'kg' },
  { id: '23784', name: '网络红歌榜', description: '酷狗网络热门歌曲', cover: '', source: 'kg' },
  { id: '52144', name: '抖音热歌榜', description: '酷狗抖音热门歌曲', cover: '', source: 'kg' },
]

const MG_TOPLISTS: DiscoveryToplist[] = [
  { id: '27553319', name: '新歌榜', description: '咪咕尖叫新歌榜', cover: '', source: 'mg' },
  { id: '27186466', name: '热歌榜', description: '咪咕尖叫热歌榜', cover: '', source: 'mg' },
  { id: '27553408', name: '原创榜', description: '咪咕尖叫原创榜', cover: '', source: 'mg' },
  { id: '75959118', name: '音乐风向榜', description: '咪咕音乐风向榜', cover: '', source: 'mg' },
]

function getBoards(source: DiscoverySource): DiscoveryToplist[] {
  if (source === 'wy') return WY_TOPLISTS
  if (source === 'kw') return KW_TOPLISTS
  if (source === 'kg') return KG_TOPLISTS
  if (source === 'mg') return MG_TOPLISTS
  return TX_TOPLISTS
}

function getCached<T>(key: string): T | null {
  return (searchCache.get(key) as T | null) ?? null
}

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}M`
}

function normalizeCover(url: string | undefined): string {
  return url?.replace(/^http:/, 'https:') ?? ''
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0',
        ...init?.headers,
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`音乐平台请求失败: ${response.status}`)
    return await response.json() as T
  } finally {
    clearTimeout(timeoutId)
  }
}

async function requestMusicu<T>(body: unknown): Promise<T> {
  return fetchJson<T>(QQ_MUSICU_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function toMusicInfo(song: QQSong): MusicInfo | null {
  const songmid = song.mid?.trim()
  const mediaMid = song.file?.media_mid?.trim()
  if (!songmid || !mediaMid) return null

  const types: QualityInfo[] = []
  const qualityMap = {} as MusicInfo['_types']
  const addQuality = (type: QualityType, bytes: number | undefined) => {
    if (!bytes || bytes <= 0) return
    const size = formatFileSize(bytes)
    types.push({ type, size })
    qualityMap[type] = { size }
  }
  addQuality('128k', song.file?.size_128mp3)
  addQuality('320k', song.file?.size_320mp3)
  addQuality('flac', song.file?.size_flac)
  addQuality('flac24bit', song.file?.size_hires)

  return {
    name: song.name || song.title || '',
    singer: song.singer?.map(item => item.name || '').filter(Boolean).join('、') || '未知歌手',
    source: 'tx',
    songmid,
    songId: song.id,
    strMediaMid: mediaMid,
    albumId: song.album?.mid || '',
    albumMid: song.album?.mid || '',
    albumName: song.album?.name || '',
    interval: String(song.interval || 0),
    img: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${song.album.mid}.jpg` : null,
    types,
    _types: qualityMap,
    typeUrl: {},
  }
}

async function enrichSongs(rawSongs: QQSong[]): Promise<Song[]> {
  const songs = rawSongs.map(toMusicInfo).filter((item): item is MusicInfo => item !== null)
  return enrichMusicInfos(songs)
}

async function enrichMusicInfos(musicInfos: MusicInfo[]): Promise<Song[]> {
  return Promise.all(musicInfos.map(async musicInfo => {
    await upsertMusicInfo(musicInfo).catch(error => logger.warn('[discovery] song upsert failed', error))
    return { ...musicInfo, uid: `${musicInfo.source}-${getStorageSongmidForMusicInfo(musicInfo)}` }
  }))
}

function createQualityInfo(type: QualityType, size?: number): QualityInfo {
  return { type, size: size && size > 0 ? formatFileSize(size) : '' }
}

type WyArtist = { name?: string }
type WyAlbum = { id?: number; name?: string; picUrl?: string }
type WyQuality = { size?: number }

function toWyMusicInfo(raw: {
  id?: number; name?: string; ar?: WyArtist[]; artists?: WyArtist[]; al?: WyAlbum; album?: WyAlbum
  pc?: { ar?: string; sn?: string; alb?: string }
  dt?: number; duration?: number
  l?: WyQuality; h?: WyQuality; sq?: WyQuality; hr?: WyQuality
  lMusic?: WyQuality; bMusic?: WyQuality; hMusic?: WyQuality; sqMusic?: WyQuality; hrMusic?: WyQuality
}): MusicInfo | null {
  const name = raw.pc?.sn || raw.name
  if (!raw.id || !name) return null
  const artists = raw.ar || raw.artists || []
  const album = raw.al || raw.album
  const duration = raw.dt ?? raw.duration ?? 0
  const types: QualityInfo[] = []
  const qualityMap = {} as MusicInfo['_types']
  const add = (type: QualityType, size: number | undefined) => {
    if (!size || size <= 0) return
    const info = createQualityInfo(type, size)
    types.push(info)
    qualityMap[type] = { size: info.size }
  }
  add('128k', raw.l?.size || raw.lMusic?.size || raw.bMusic?.size)
  add('320k', raw.h?.size || raw.hMusic?.size)
  add('flac', raw.sq?.size || raw.sqMusic?.size)
  add('flac24bit', raw.hr?.size || raw.hrMusic?.size)
  return {
    name,
    singer: raw.pc?.ar || artists.map(item => item.name || '').filter(Boolean).join('、') || '未知歌手',
    source: 'wy',
    songmid: String(raw.id),
    songId: raw.id,
    albumId: album?.id ? String(album.id) : '',
    albumName: raw.pc?.alb || album?.name || '',
    interval: String(Math.round(duration / 1_000)),
    img: normalizeCover(album?.picUrl) || null,
    types,
    _types: qualityMap,
    typeUrl: {},
  }
}

function toKwMusicInfo(raw: {
  id?: string | number; name?: string; artist?: string; album?: string; albumid?: string | number
  duration?: string | number; pic?: string; formats?: string
}): MusicInfo | null {
  if (!raw.id || !raw.name) return null
  const formats = raw.formats || ''
  const types: QualityInfo[] = []
  const qualityMap = {} as MusicInfo['_types']
  const add = (type: QualityType, present: boolean) => {
    if (!present) return
    types.push({ type, size: '' })
    qualityMap[type] = { size: '' }
  }
  add('128k', /MP3128|ZPGA201/.test(formats))
  add('320k', /MP3H|ZPGA501/.test(formats))
  add('flac', /ALFLAC|ZPGA714/.test(formats))
  if (types.length === 0) add('128k', true)
  return {
    name: raw.name,
    singer: raw.artist || '未知歌手',
    source: 'kw',
    songmid: String(raw.id),
    albumId: raw.albumid ? String(raw.albumid) : '',
    albumName: raw.album || '',
    interval: String(raw.duration || 0),
    img: normalizeCover(raw.pic),
    types,
    _types: qualityMap,
    typeUrl: {},
  }
}

type KgSong = {
  audio_id?: string | number
  songname?: string
  filename?: string
  authors?: Array<{ author_name?: string }>
  remark?: string
  album_id?: string | number
  duration?: string | number
  album_sizable_cover?: string
  hash?: string
  filesize?: number
  '320filesize'?: number
  '320hash'?: string
  sqfilesize?: number
  sqhash?: string
  filesize_high?: number
  hash_high?: string
}

function toKgMusicInfo(raw: KgSong): MusicInfo | null {
  if (!raw.audio_id || !(raw.songname || raw.filename)) return null
  const types: QualityInfo[] = []
  const qualityMap = {} as MusicInfo['_types']
  const add = (type: QualityType, size: number | undefined, hash: string | undefined) => {
    if (!size || size <= 0 || !hash) return
    const info = createQualityInfo(type, size)
    types.push({ ...info, hash })
    qualityMap[type] = { size: info.size, hash }
  }
  add('128k', raw.filesize, raw.hash)
  add('320k', raw['320filesize'], raw['320hash'])
  add('flac', raw.sqfilesize, raw.sqhash)
  add('flac24bit', raw.filesize_high, raw.hash_high)
  if (types.length === 0 && raw.hash) {
    types.push({ type: '128k', size: '', hash: raw.hash })
    qualityMap['128k'] = { size: '', hash: raw.hash }
  }
  const filenameParts = raw.filename?.split(' - ') || []
  return {
    name: raw.songname || filenameParts.slice(1).join(' - ') || raw.filename || '',
    singer: raw.authors?.map(item => item.author_name || '').filter(Boolean).join('、') || filenameParts[0] || '未知歌手',
    source: 'kg',
    songmid: String(raw.audio_id),
    albumId: raw.album_id ? String(raw.album_id) : '',
    albumName: raw.remark || '',
    interval: String(raw.duration || 0),
    img: normalizeCover(raw.album_sizable_cover?.replace('{size}', '400')) || null,
    hash: raw.hash,
    types,
    _types: qualityMap,
    typeUrl: {},
  }
}

type MgFormat = { formatType?: string; size?: number; androidSize?: number; isize?: number }
type MgSong = {
  songId?: string | number
  songName?: string
  artists?: Array<{ name?: string }>
  singerList?: Array<{ name?: string }>
  albumId?: string | number
  album?: string
  albumImgs?: Array<{ img?: string }>
  img1?: string
  img2?: string
  img3?: string
  duration?: string | number
  length?: string
  copyrightId?: string | number
  newRateFormats?: MgFormat[]
  audioFormats?: MgFormat[]
  lrcUrl?: string
  mrcUrl?: string
  trcUrl?: string
}

function normalizeMgCover(url: string | undefined): string {
  if (!url) return ''
  return normalizeCover(/^https?:/.test(url) ? url : `https://d.musicapp.migu.cn${url}`)
}

function toMgMusicInfo(raw: MgSong): MusicInfo | null {
  if (!raw.songId || !raw.songName) return null
  const types: QualityInfo[] = []
  const qualityMap = {} as MusicInfo['_types']
  const typeMap: Record<string, QualityType> = { PQ: '128k', HQ: '320k', SQ: 'flac', ZQ: 'flac24bit', ZQ24: 'flac24bit' }
  for (const format of raw.audioFormats || raw.newRateFormats || []) {
    const type = typeMap[format.formatType || '']
    if (!type || qualityMap[type]) continue
    const info = createQualityInfo(type, format.size || format.androidSize || format.isize)
    types.push(info)
    qualityMap[type] = { size: info.size }
  }
  if (types.length === 0) {
    types.push({ type: '128k', size: '' })
    qualityMap['128k'] = { size: '' }
  }
  const duration = typeof raw.duration === 'number'
    ? Math.round(raw.duration)
    : raw.duration || raw.length || 0
  return {
    name: raw.songName,
    singer: (raw.singerList || raw.artists || []).map(item => item.name || '').filter(Boolean).join('、') || '未知歌手',
    source: 'mg',
    songmid: String(raw.songId),
    albumId: raw.albumId ? String(raw.albumId) : '',
    albumName: raw.album || '',
    interval: String(duration),
    img: normalizeMgCover(raw.img3 || raw.img2 || raw.img1 || raw.albumImgs?.[0]?.img) || null,
    copyrightId: raw.copyrightId ? String(raw.copyrightId) : undefined,
    lrcUrl: raw.lrcUrl,
    mrcUrl: raw.mrcUrl,
    trcUrl: raw.trcUrl,
    types,
    _types: qualityMap,
    typeUrl: {},
  }
}

async function getWyPlaylistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const payload = await fetchJson<{ result?: { name?: string; description?: string; coverImgUrl?: string; creator?: { nickname?: string }; tracks?: Parameters<typeof toWyMusicInfo>[0][] } }>(`https://music.163.com/api/playlist/detail?id=${encodeURIComponent(id)}`)
  const playlist = payload.result
  if (!playlist?.tracks) return null
  return {
    id,
    name: playlist.name || '',
    description: playlist.description || '',
    cover: normalizeCover(playlist.coverImgUrl),
    author: playlist.creator?.nickname || '网易云音乐',
    tracks: await enrichMusicInfos(playlist.tracks.map(toWyMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

async function getKwPlaylistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const payload = await fetchJson<{ result?: string; title?: string; info?: string; pic?: string; uname?: string; musiclist?: Parameters<typeof toKwMusicInfo>[0][] }>(`http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encodeURIComponent(id)}&pn=0&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`)
  if (payload.result !== 'ok' || !payload.musiclist) return null
  return {
    id,
    name: payload.title || '',
    description: payload.info || '',
    cover: normalizeCover(payload.pic),
    author: payload.uname || '酷我音乐',
    tracks: await enrichMusicInfos(payload.musiclist.map(toKwMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

async function getWyToplistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  return getWyPlaylistDetail(id)
}

async function getKwToplistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const payload = await fetchJson<{ name?: string; info?: string; pic?: string; pub?: string; musiclist?: Parameters<typeof toKwMusicInfo>[0][] }>(`http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=0&rn=100&type=bang&data=content&id=${encodeURIComponent(id)}&show_copyright_off=0&pcmp4=1&isbang=1`)
  if (!payload.musiclist) return null
  return {
    id,
    name: payload.name || '',
    description: payload.info || '',
    cover: normalizeCover(payload.pic),
    author: '酷我音乐',
    updateTime: payload.pub,
    tracks: await enrichMusicInfos(payload.musiclist.map(toKwMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

async function getKgToplistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const payload = await fetchJson<{ data?: { total?: number; info?: KgSong[] } }>(`http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=100&area_code=1&page=1&rankid=${encodeURIComponent(id)}&with_res_tag=0&show_portrait_mv=1`)
  const board = KG_TOPLISTS.find(item => item.id === id)
  const songs = payload.data?.info || []
  if (songs.length === 0) return null
  return {
    id,
    name: board?.name || '酷狗音乐榜单',
    description: board?.description || '',
    cover: '',
    author: '酷狗音乐',
    tracks: await enrichMusicInfos(songs.map(toKgMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

async function getMgToplistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const payload = await fetchJson<{ code?: string; columnInfo?: { columnTitle?: string; columnUpdateTime?: string; contents?: Array<{ objectInfo?: MgSong }> } }>(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${encodeURIComponent(id)}&needAll=0`)
  const board = MG_TOPLISTS.find(item => item.id === id)
  const songs = payload.columnInfo?.contents?.map(item => item.objectInfo).filter((item): item is MgSong => Boolean(item)) || []
  if (payload.code !== '000000' || songs.length === 0) return null
  return {
    id,
    name: payload.columnInfo?.columnTitle || board?.name || '咪咕音乐榜单',
    description: board?.description || '',
    cover: '',
    author: '咪咕音乐',
    updateTime: payload.columnInfo?.columnUpdateTime,
    tracks: await enrichMusicInfos(songs.map(toMgMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

type KgPlaylistInfo = {
  specialid?: string | number
  specialname?: string
  nickname?: string
  intro?: string
  imgurl?: string
  playcount?: number
  songcount?: number
}

async function getKgPlaylistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const [songsPayload, infoPayload] = await Promise.all([
    fetchJson<{ data?: { info?: KgSong[] } }>(`http://mobilecdnbj.kugou.com/api/v3/special/song?version=9108&specialid=${encodeURIComponent(id)}&plat=0&pagesize=100&page=1`),
    fetchJson<{ data?: KgPlaylistInfo }>(`http://mobilecdnbj.kugou.com/api/v5/special/info?specialid=${encodeURIComponent(id)}`).catch(error => {
      logger.warn('[discovery] Kugou playlist metadata request failed', error)
      return null
    }),
  ])
  const songs = songsPayload.data?.info || []
  if (songs.length === 0) return null
  const info = infoPayload?.data
  return {
    id,
    name: info?.specialname || '酷狗推荐歌单',
    description: info?.intro || '',
    cover: normalizeCover(info?.imgurl?.replace('{size}', '400')),
    author: info?.nickname || '酷狗音乐',
    tracks: await enrichMusicInfos(songs.map(toKgMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

async function getMgPlaylistDetail(id: string): Promise<DiscoveryCollectionDetail | null> {
  const headers = { Referer: 'https://m.music.migu.cn/' }
  const [songsPayload, infoPayload] = await Promise.all([
    fetchJson<{ code?: string; data?: { songList?: MgSong[] } }>(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=1&pageSize=100&playlistId=${encodeURIComponent(id)}`, { headers }),
    fetchJson<{ code?: string; data?: { title?: string; summary?: string; ownerName?: string; imgItem?: { img?: string } } }>(`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${encodeURIComponent(id)}`, { headers }),
  ])
  const songs = songsPayload.data?.songList || []
  if (songsPayload.code !== '000000' || songs.length === 0) return null
  const info = infoPayload.data
  return {
    id,
    name: info?.title || '咪咕推荐歌单',
    description: info?.summary || '',
    cover: normalizeMgCover(info?.imgItem?.img),
    author: info?.ownerName || '咪咕音乐',
    tracks: await enrichMusicInfos(songs.map(toMgMusicInfo).filter((item): item is MusicInfo => item !== null)),
  }
}

async function getSongsByIds(ids: number[]): Promise<Song[]> {
  const uniqueIds = [...new Set(ids.filter(Number.isFinite))].slice(0, 100)
  if (uniqueIds.length === 0) return []
  const query = new URLSearchParams({ songid: uniqueIds.join(','), format: 'json' })
  const payload = await fetchJson<{ code?: number; data?: QQSong[] }>(`${QQ_SINGLE_SONG_URL}?${query}`)
  if (payload.code !== 0 || !Array.isArray(payload.data)) throw new Error('QQ 音乐未返回歌曲详情')
  const songs = await enrichSongs(payload.data)
  const order = new Map(uniqueIds.map((id, index) => [id, index]))
  return songs.sort((a, b) => (order.get(Number(a.songId)) ?? 999) - (order.get(Number(b.songId)) ?? 999))
}

async function getRecommendedPlaylistRecords(limit: number, page = 1, filter: DiscoveryPlaylistFilter = {}): Promise<PlaylistRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 30))
  const safePage = Math.max(1, Math.floor(page))
  const cacheKey = `discovery:v2:tx:playlists:${safeLimit}:${safePage}:${filter.tag || ''}:${filter.sort || 'recommend'}`
  const cached = getCached<PlaylistRecord[]>(cacheKey)
  if (cached) return cached

  if (filter.tag) {
    const payload = await requestMusicu<{ playlist?: { code?: number; data?: { content?: { v_item?: Array<{ basic?: { tid?: number; title?: string; creator?: { nick?: string }; desc?: string; cover?: { medium_url?: string; default_url?: string }; play_cnt?: number; song_cnt?: number } }> } } } }>({
      comm: { cv: 1602, ct: 20 },
      playlist: { module: 'playlist.PlayListCategoryServer', method: 'get_category_content', param: { titleid: Number(filter.tag), category_id: Number(filter.tag), caller: '0', size: safeLimit, page: safePage - 1, use_page: 1, order: filter.sort === 'hot' ? 5 : 2, sort: filter.sort === 'hot' ? 5 : 2 } },
    })
    const records = payload.playlist?.data?.content?.v_item?.map(item => ({
      id: String(item.basic?.tid || ''), name: item.basic?.title || '', author: item.basic?.creator?.nick || 'QQ 音乐', description: item.basic?.desc || '', cover: normalizeCover(item.basic?.cover?.medium_url || item.basic?.cover?.default_url), playCount: item.basic?.play_cnt || 0, songCount: item.basic?.song_cnt || 0, source: 'tx' as const, songIds: [],
    })).filter(item => item.id && item.name) || []
    searchCache.set(cacheKey, records, CACHE_TTL)
    return records
  }
  const payload = await requestMusicu<{
    playlist?: { code?: number; data?: { v_playlist?: Array<{
      tid?: number; title?: string; cover_url_medium?: string; creator_info?: { nick?: string }
      access_num?: number; desc?: string; song_ids?: number[]
    }> } }
  }>({
    comm: { cv: 1602, ct: 20 },
    playlist: {
      module: 'playlist.PlayListPlazaServer',
      method: 'get_playlist_by_tag',
      param: { id: 10000000, sin: (safePage - 1) * safeLimit, size: safeLimit, order: filter.sort === 'hot' ? 5 : 2, cur_page: safePage },
    },
  })
  const entries = payload.playlist?.data?.v_playlist
  if (payload.playlist?.code !== 0 || !Array.isArray(entries)) throw new Error('QQ 音乐未返回推荐歌单')

  const records = entries
    .filter(item => item.tid && item.title)
    .map(item => ({
      id: String(item.tid),
      name: item.title || '',
      author: item.creator_info?.nick || 'QQ 音乐',
      description: item.desc || '',
      cover: normalizeCover(item.cover_url_medium),
      playCount: item.access_num || 0,
      songCount: item.song_ids?.length || 0,
      source: 'tx' as const,
      songIds: item.song_ids || [],
    }))
  searchCache.set(cacheKey, records, CACHE_TTL)
  records.forEach(record => searchCache.set(`discovery:tx:playlist-record:${record.id}`, record, CACHE_TTL))
  return records
}

async function getWyRecommendedPlaylists(limit: number, page: number, filter: DiscoveryPlaylistFilter): Promise<DiscoveryPlaylist[]> {
  const query = new URLSearchParams({ cat: filter.tag || '全部', order: filter.sort === 'hot' ? 'hot' : 'new', limit: String(limit), offset: String((page - 1) * limit) })
  const payload = await fetchJson<{ playlists?: Array<{ id?: number; name?: string; creator?: { nickname?: string }; description?: string; coverImgUrl?: string; playCount?: number; trackCount?: number }> }>(`https://music.163.com/api/playlist/list?${query}`)
  return (payload.playlists || []).filter(item => item.id && item.name).map(item => ({
    id: String(item.id),
    name: item.name || '',
    author: item.creator?.nickname || '网易云音乐',
    description: item.description || '',
    cover: normalizeCover(item.coverImgUrl),
    playCount: item.playCount || 0,
    songCount: item.trackCount || 0,
    source: 'wy',
  }))
}

async function getKwRecommendedPlaylists(limit: number, page: number, filter: DiscoveryPlaylistFilter): Promise<DiscoveryPlaylist[]> {
  if (filter.tag) {
    const [tagId, digest] = filter.tag.split('-')
    const query = new URLSearchParams({ loginUid: '0', loginSid: '0', appUid: '76039576', pn: String(page), rn: String(limit), id: tagId })
    const payload = await fetchJson<{ code?: number; data?: { data?: Array<{ id?: string | number; name?: string; uname?: string; desc?: string; img?: string; listencnt?: string | number; total?: string | number }> } }>(`http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList?${query}`)
    const entries = payload.data?.data || []
    if (payload.code !== 200 || !['43', '10000'].includes(digest || '')) throw new Error('酷我未返回分类歌单')
    return entries.filter(item => item.id && item.name).map(item => ({ id: String(item.id), name: item.name || '', author: item.uname || '酷我音乐', description: item.desc || '', cover: normalizeCover(item.img), playCount: Number(item.listencnt) || 0, songCount: Number(item.total) || 0, source: 'kw' }))
  }
  const query = new URLSearchParams({ loginUid: '0', loginSid: '0', appUid: '76039576', pn: String(page), rn: String(limit), order: filter.sort === 'hot' ? 'hot' : 'new' })
  const payload = await fetchJson<{ code?: number; data?: { data?: Array<{ id?: string | number; name?: string; uname?: string; desc?: string; img?: string; listencnt?: string | number; total?: string | number }> } }>(`http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?${query}`)
  const entries = payload.data?.data || []
  if (payload.code !== 200) throw new Error('酷我未返回推荐歌单')
  return entries.filter(item => item.id && item.name).map(item => ({
    id: String(item.id),
    name: item.name || '',
    author: item.uname || '酷我音乐',
    description: item.desc || '',
    cover: normalizeCover(item.img),
    playCount: Number(item.listencnt) || 0,
    songCount: Number(item.total) || 0,
    source: 'kw',
  }))
}

type KgPlaylistSummary = {
  specialid?: string | number
  specialname?: string
  nickname?: string
  intro?: string
  img?: string
  imgurl?: string
  total_play_count?: string | number
  play_count?: string | number
  songcount?: string | number
  song_count?: string | number
}

function parseKgCount(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const match = String(value).match(/^([\d.]+)\s*([万亿])?$/)
  if (!match) return Number(value) || 0
  const number = Number(match[1])
  return match[2] === '亿' ? Math.round(number * 100_000_000) : match[2] === '万' ? Math.round(number * 10_000) : number
}

/** 与 lxserver kg/songList.js 的歌单广场接口一致，支持连续分页。 */
async function getKgRecommendedPlaylists(limit: number, page: number, filter: DiscoveryPlaylistFilter): Promise<DiscoveryPlaylist[]> {
  const sortId = ({ recommend: '5', hot: '6', new: '7', collect: '3', soar: '8' } as Record<DiscoveryPlaylistSort, string>)[filter.sort || 'recommend']
  const payload = await fetchJson<{ status?: number; special_db?: KgPlaylistSummary[] }>(`http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_ajax=1&cdn=cdn&t=${sortId}&c=${encodeURIComponent(filter.tag || '')}&p=${page}`)
  const entries = (payload.special_db || []).filter(item => item.specialid && item.specialname).slice(0, limit)
  if (payload.status !== 1) throw new Error('酷狗未返回推荐歌单')

  return entries.map(item => {
    const songCount = Number(item.songcount || item.song_count)
    return {
      id: String(item.specialid),
      name: item.specialname || '',
      author: item.nickname || '酷狗音乐',
      description: item.intro || '',
      cover: normalizeCover((item.img || item.imgurl || '').replace('{size}', '400')),
      playCount: parseKgCount(item.total_play_count || item.play_count),
      ...(songCount > 0 ? { songCount } : {}),
      source: 'kg',
    }
  })
}

type MgPlaylistNode = {
  contents?: MgPlaylistNode[]
  resType?: string | number
  resId?: string | number
  txt?: string
  txt2?: string
  img?: string
}

function collectMgRecommendedPlaylists(nodes: MgPlaylistNode[], playlists: DiscoveryPlaylist[] = [], ids = new Set<string>()): DiscoveryPlaylist[] {
  for (const node of nodes) {
    if (node.contents) collectMgRecommendedPlaylists(node.contents, playlists, ids)
    const id = node.resId ? String(node.resId) : ''
    if (String(node.resType) !== '2021' || !id || !node.txt || ids.has(id)) continue
    ids.add(id)
    playlists.push({
      id,
      name: node.txt,
      author: '咪咕音乐',
      description: node.txt2 || '',
      cover: normalizeMgCover(node.img),
      playCount: 0,
      source: 'mg',
    })
  }
  return playlists
}

async function getMgRecommendedPlaylists(limit: number, page: number, filter: DiscoveryPlaylistFilter): Promise<DiscoveryPlaylist[]> {
  if (filter.tag) {
    const payload = await fetchJson<{ code?: string; data?: { contentItemList?: Array<{ itemList?: Array<{ title?: string; imageUrl?: string; logEvent?: { contentId?: string }; barList?: Array<{ title?: string }> }> }> } }>(`https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?pageNumber=${page}&templateVersion=2&tagId=${encodeURIComponent(filter.tag)}`)
    if (payload.code !== '000000') throw new Error('咪咕未返回分类歌单')
    const entries = (payload.data?.contentItemList || []).flatMap(group => group.itemList || []).filter(item => item.logEvent?.contentId && item.title).slice(0, limit)
    // 列表接口没有曲目数：不为每一项额外请求详情，避免首页产生 N+1 请求。
    return entries.map(item => ({
      id: item.logEvent?.contentId || '',
      name: item.title || '',
      author: '咪咕音乐',
      description: '',
      cover: normalizeMgCover(item.imageUrl),
      playCount: parseKgCount(item.barList?.[0]?.title),
      source: 'mg' as const,
    }))
  }
  const payload = await fetchJson<{ code?: string; data?: { contents?: MgPlaylistNode[] } }>(`https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`)
  if (payload.code !== '000000') throw new Error('咪咕未返回推荐歌单')
  return collectMgRecommendedPlaylists(payload.data?.contents || []).slice(0, limit)
}

export async function getToplists(source: DiscoverySource = 'tx'): Promise<DiscoveryToplist[]> {
  return getBoards(source)
}

export async function getToplistDetail(source: DiscoverySource, id: string): Promise<DiscoveryCollectionDetail | null> {
  const board = getBoards(source).find(item => item.id === id)
  if (!board) return null
  // v2：网易云公开接口字段已更新，避免复用旧字段映射写入的缓存。
  const cacheKey = `discovery:v2:${source}:toplist:${id}`
  const cached = getCached<DiscoveryCollectionDetail>(cacheKey)
  if (cached) return cached

  if (source === 'wy') {
    const detail = await getWyToplistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  if (source === 'kw') {
    const detail = await getKwToplistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  if (source === 'kg') {
    const detail = await getKgToplistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  if (source === 'mg') {
    const detail = await getMgToplistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }

  const payload = await requestMusicu<{
    toplist?: { code?: number; data?: { data?: {
      title?: string; intro?: string; headPicUrl?: string; updateTime?: string; song?: Array<{ songId?: number }>
    } } }
  }>({
    toplist: {
      module: 'musicToplist.ToplistInfoServer',
      method: 'GetDetail',
      param: { topid: Number(id), num: 100, period: '' },
    },
    comm: { uin: 0, format: 'json', ct: 20, cv: 1859 },
  })
  const data = payload.toplist?.data?.data
  const songIds = data?.song?.map(item => item.songId || 0).filter(Boolean) || []
  if (payload.toplist?.code !== 0 || songIds.length === 0) throw new Error('QQ 音乐未返回榜单歌曲')
  const detail: DiscoveryCollectionDetail = {
    id,
    name: data?.title || board.name,
    description: data?.intro?.replace(/<br\s*\/?>/gi, '\n') || board.description,
    cover: normalizeCover(data?.headPicUrl),
    author: 'QQ 音乐',
    updateTime: data?.updateTime,
    tracks: await getSongsByIds(songIds),
  }
  searchCache.set(cacheKey, detail, CACHE_TTL)
  return detail
}

export async function getRecommendedPlaylists(source: DiscoverySource = 'tx', limit = 12, page = 1, filter: DiscoveryPlaylistFilter = {}): Promise<DiscoveryPlaylist[]> {
  const safeLimit = Math.max(1, Math.min(limit, 30))
  const safePage = Math.max(1, Math.floor(page))
  // v7：所有渠道的歌单列表均不再逐项请求详情，避免首页产生 N+1 请求。
  const cacheKey = `discovery:v7:${source}:playlist-list:${safeLimit}:${safePage}:${filter.tag || ''}:${filter.sort || 'recommend'}:${filter.keyword || ''}`
  const cached = getCached<DiscoveryPlaylist[]>(cacheKey)
  if (cached) return cached
  if (source === 'wy') {
    const playlists = await getWyRecommendedPlaylists(safeLimit, safePage, filter)
    searchCache.set(cacheKey, playlists, CACHE_TTL)
    return playlists
  }
  if (source === 'kw') {
    const playlists = await getKwRecommendedPlaylists(safeLimit, safePage, filter)
    searchCache.set(cacheKey, playlists, CACHE_TTL)
    return playlists
  }
  if (source === 'kg') {
    const playlists = await getKgRecommendedPlaylists(safeLimit, safePage, filter)
    searchCache.set(cacheKey, playlists, CACHE_TTL)
    return playlists
  }
  if (source === 'mg') {
    const playlists = await getMgRecommendedPlaylists(safeLimit, safePage, filter)
    searchCache.set(cacheKey, playlists, CACHE_TTL)
    return playlists
  }
  const records = await getRecommendedPlaylistRecords(safeLimit, safePage, filter)
  const playlists = records.map(item => ({
    id: item.id,
    name: item.name,
    author: item.author,
    description: item.description,
    cover: item.cover,
    playCount: item.playCount,
    songCount: item.songCount,
    source: item.source,
  }))
  searchCache.set(cacheKey, playlists, CACHE_TTL)
  return playlists
}

export async function getRecommendedPlaylistDetail(source: DiscoverySource, id: string): Promise<DiscoveryCollectionDetail | null> {
  const cacheKey = `discovery:v2:${source}:playlist:${id}`
  const cached = getCached<DiscoveryCollectionDetail>(cacheKey)
  if (cached) return cached
  if (source === 'wy') {
    const detail = await getWyPlaylistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  if (source === 'kw') {
    const detail = await getKwPlaylistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  if (source === 'kg') {
    const detail = await getKgPlaylistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  if (source === 'mg') {
    const detail = await getMgPlaylistDetail(id)
    if (detail) searchCache.set(cacheKey, detail, CACHE_TTL)
    return detail
  }
  const record = getCached<PlaylistRecord>(`discovery:tx:playlist-record:${id}`)
    || (await getRecommendedPlaylistRecords(30)).find(item => item.id === id)
  if (!record || record.songIds.length === 0) return null
  const detail: DiscoveryCollectionDetail = {
    id,
    name: record.name,
    description: record.description,
    cover: record.cover,
    author: record.author,
    tracks: await getSongsByIds(record.songIds),
  }
  searchCache.set(cacheKey, detail, CACHE_TTL)
  return detail
}
