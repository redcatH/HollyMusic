import type { MusicInfo, QualityInfo } from '../types/music'

export interface CsvPlaylistRow {
  index: number
  name: string
  singer: string
  albumName: string
  songId: string
  interval: string
}

export interface ParsedCsvPlaylist {
  rows: CsvPlaylistRow[]
  duplicateCount: number
}

export interface ImportedSong extends MusicInfo {
  importQualityFallback?: boolean
}

export interface PlaylistImportResult {
  playlistId: number
  totalRows: number
  added: number
  duplicates: number
  qualityFallback: number
  songCount: number
}

export const MAX_CSV_BYTES = 2 * 1024 * 1024
export const MAX_ROWS = 5_000

const QQ_HOSTS = new Set(['y.qq.com', 'i.y.qq.com', 'i2.y.qq.com', 'c.y.qq.com'])

export function parseQqPlaylistInput(input: string): string {
  const value = input.trim()
  if (/^\d+$/.test(value)) return value
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入 QQ 音乐歌单链接或数字歌单 ID') }
  if (!QQ_HOSTS.has(url.hostname.toLowerCase())) throw new Error('只支持 QQ 音乐歌单链接')
  const queryId = url.searchParams.get('id')
  const pathId = url.pathname.match(/(?:playlist|playsquare)[^\d]*(\d+)/i)?.[1]
  const id = queryId || pathId
  if (!id || !/^\d+$/.test(id)) throw new Error('QQ 音乐链接中没有有效歌单 ID')
  return id
}


function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-]/g, '')
}

function normalizeInterval(value: string): string {
  const text = value.trim()
  if (!text) return ''
  const parts = text.split(':').map(Number)
  if (parts.length === 2 && parts.every(Number.isFinite)) return String(parts[0] * 60 + parts[1])
  if (parts.length === 3 && parts.every(Number.isFinite)) return String(parts[0] * 3600 + parts[1] * 60 + parts[2])
  return text
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field.length === 0) {
      quoted = true
    } else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i += 1
      record.push(field)
      if (record.some(value => value.trim() !== '')) records.push(record)
      record = []
      field = ''
    } else {
      field += char
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  if (field.length > 0 || record.length > 0) {
    record.push(field)
    if (record.some(value => value.trim() !== '')) records.push(record)
  }
  return records
}

function getColumnIndex(headers: string[], aliases: string[]): number {
  const wanted = aliases.map(normalizeHeader)
  return headers.findIndex(header => wanted.includes(normalizeHeader(header)))
}

export function parseNeteaseCsv(text: string): ParsedCsvPlaylist {
  const records = parseCsvRecords(text)
  if (records.length < 2) throw new Error('CSV 至少需要一行表头和一行歌曲')
  const headers = records[0]
  const nameIndex = getColumnIndex(headers, ['歌名', '歌曲名', 'title', 'name', 'songname'])
  const singerIndex = getColumnIndex(headers, ['歌手', '艺术家', 'artist', 'artists', 'singer'])
  const albumIndex = getColumnIndex(headers, ['专辑', 'album', 'albumname'])
  const idIndex = getColumnIndex(headers, ['歌曲id', '歌曲ID', '网易云歌曲ID', 'neteasesongid', 'songid', 'id'])
  const durationIndex = getColumnIndex(headers, ['时长', 'duration', 'durationms'])
  if (nameIndex < 0 || singerIndex < 0 || idIndex < 0) {
    throw new Error('CSV 必须包含歌名、歌手和歌曲ID列')
  }
  if (records.length - 1 > MAX_ROWS) throw new Error(`CSV 最多支持 ${MAX_ROWS} 首歌曲`)

  const seen = new Set<string>()
  let duplicateCount = 0
  const rows: CsvPlaylistRow[] = []
  records.slice(1).forEach((record, rowIndex) => {
    const songId = (record[idIndex] || '').trim()
    const name = (record[nameIndex] || '').trim()
    const singer = (record[singerIndex] || '').trim()
    if (!/^\d+$/.test(songId) || !name || !singer) return
    if (seen.has(songId)) {
      duplicateCount += 1
      return
    }
    seen.add(songId)
    rows.push({
      index: Number(record[0]) || rowIndex + 1,
      name,
      singer,
      albumName: albumIndex >= 0 ? (record[albumIndex] || '').trim() : '',
      songId,
      interval: durationIndex >= 0 ? normalizeInterval(record[durationIndex] || '') : '',
    })
  })
  if (rows.length === 0) throw new Error('CSV 中没有可导入的歌曲记录')
  return { rows, duplicateCount }
}

export function assertCsvSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('CSV 文件为空')
  if (bytes > MAX_CSV_BYTES) throw new Error(`CSV 文件不能超过 ${MAX_CSV_BYTES / 1024 / 1024}MB`)
}

function fallbackQuality(): { types: QualityInfo[]; _types: MusicInfo['_types'] } {
  const types: QualityInfo[] = [{ type: '128k', size: '' }]
  return {
    types,
    _types: {
      '128k': { size: '' },
    } as MusicInfo['_types'],
  }
}

export function createFallbackMusicInfo(row: CsvPlaylistRow): ImportedSong {
  const quality = fallbackQuality()
  return {
    source: 'wy',
    songmid: row.songId,
    songId: row.songId,
    name: row.name,
    singer: row.singer,
    albumName: row.albumName,
    albumId: '',
    interval: row.interval,
    img: null,
    types: quality.types,
    _types: quality._types,
    typeUrl: {},
    importQualityFallback: true,
  }
}

export function mergeImportedSong(row: CsvPlaylistRow, fetched: MusicInfo | undefined): ImportedSong {
  if (!fetched) return createFallbackMusicInfo(row)
  if (!fetched.types?.length || !Object.keys(fetched._types || {}).length) {
    return {
      ...createFallbackMusicInfo(row),
      ...fetched,
      songmid: row.songId,
      songId: fetched.songId || row.songId,
      name: fetched.name || row.name,
      singer: fetched.singer || row.singer,
      albumName: fetched.albumName || row.albumName,
      interval: fetched.interval || row.interval,
      importQualityFallback: true,
    }
  }
  return {
    ...fetched,
    songmid: row.songId,
    songId: fetched.songId || row.songId,
    name: fetched.name || row.name,
    singer: fetched.singer || row.singer,
    albumName: fetched.albumName || row.albumName,
    interval: fetched.interval || row.interval,
  }
}
