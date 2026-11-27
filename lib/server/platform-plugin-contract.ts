import { isCapability, isPlatformId, type PluginCapability, type PluginManifest } from '@/lib/platform-plugins'
import { isQuality } from '@/lib/quality-options'
import type { MusicInfo, QualityInfo } from '@/lib/types/music'

export class PluginError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginError('平台插件返回的对象无效')
  return value as Record<string, unknown>
}

const text = (value: unknown, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : ''
export const safeId = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

function origin(value: unknown): string {
  try {
    if (typeof value === 'string') {
      const url = new URL(value)
      if (url.origin === value && url.protocol === 'https:' && !url.port && url.hostname.includes('.')) return value
    }
  } catch { /* validated below */ }
  throw new PluginError('请求域名须为 HTTPS origin')
}

export function parseManifest(raw: unknown): PluginManifest {
  const data = record(raw)
  if (data.apiVersion !== 1 || typeof data.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(data.id)
    || typeof data.version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-zA-Z0-9.-]{1,32})?$/.test(data.version)
    || !text(data.name) || !Array.isArray(data.platforms) || data.platforms.length < 1 || data.platforms.length > 16) {
    throw new PluginError('平台包声明无效，检查包 ID、版本和平台列表')
  }
  const platforms = data.platforms.map(item => {
    const p = record(item)
    if (!isPlatformId(p.id) || !text(p.name) || !Array.isArray(p.capabilities) || !p.capabilities.length
      || !p.capabilities.every(isCapability) || !Array.isArray(p.origins) || p.origins.length > 12) {
      throw new PluginError('平台声明无效，检查平台 ID、处理函数和请求域名')
    }
    if (p.capabilities.includes('listPlaylistCategories') && !p.capabilities.includes('listPlaylists')) {
      throw new PluginError('声明歌单分类时须同时提供推荐歌单功能')
    }
    return { id: p.id, name: text(p.name, 80), capabilities: [...new Set<PluginCapability>(p.capabilities)], origins: [...new Set(p.origins.map(origin))] }
  })
  if (new Set(platforms.map(p => p.id)).size !== platforms.length) throw new PluginError('平台 ID 重复')
  return { apiVersion: 1, id: data.id, name: text(data.name, 120), version: data.version, platforms }
}

function httpsCover(value: unknown): string {
  try {
    if (typeof value === 'string' && value.length <= 2048) {
      const url = new URL(value)
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href
    }
  } catch { /* render a placeholder */ }
  return ''
}

export interface CatalogItem {
  id: string
  name: string
  source: string
  author: string
  cover: string
  description: string
  songCount?: number
  playCount: number
}

export interface PluginPage<T> { items: T[]; hasMore: boolean; nextCursor?: string; total?: number; collection?: CatalogItem }
export type CatalogPage = PluginPage<MusicInfo | CatalogItem>

function normalizeSong(value: Record<string, unknown>, source: string, id: string, name: string): MusicInfo {
  const qualities = new Map<string, QualityInfo>()
  for (const entry of Array.isArray(value.qualities) ? value.qualities.slice(0, 16) : []) {
    const quality = typeof entry === 'string' ? { type: entry } : record(entry)
    const type = quality.type === 'hires' ? 'flac24bit' : quality.type
    if (isQuality(type)) qualities.set(type, { type, size: text(quality.size, 24), sizeBytes: count(quality.sizeBytes), hash: text(quality.hash, 128) || undefined })
  }
  const types = [...qualities.values()]
  return {
    source, songmid: id, name, singer: text(value.artist) || '未知歌手', interval: String(Math.floor((count(value.durationMs) ?? 0) / 1000)),
    albumId: safeId(value.albumId) ? value.albumId : undefined, albumName: text(value.album), img: httpsCover(value.cover), catalogCover: true,
    hash: text(value.hash, 128) || undefined, copyrightId: text(value.copyrightId, 128) || undefined,
    strMediaMid: text(value.strMediaMid, 128) || undefined, albumMid: text(value.albumMid, 128) || undefined,
    albumAudioId: safeId(value.albumAudioId) ? value.albumAudioId : undefined,
    songId: safeId(value.upstreamSongId) ? value.upstreamSongId : undefined,
    types, _types: Object.fromEntries(types.map(item => [item.type, item])), typeUrl: {},
  }
}

function normalizeCollection(value: Record<string, unknown>, source: string, id: string, name: string): CatalogItem {
  return { id, source, name, author: text(value.author), cover: httpsCover(value.cover), description: text(value.description, 1500),
    songCount: count(value.songCount), playCount: count(value.playCount) ?? 0 }
}

export function parseCatalogPage(raw: unknown, capability: PluginCapability, source: string, limit: number): CatalogPage {
  const data = record(raw)
  if (!Array.isArray(data.items) || data.items.length > limit || typeof data.hasMore !== 'boolean') throw new PluginError('平台插件返回的分页格式无效')
  const songs = capability === 'searchSongs' || capability === 'getPlaylist' || capability === 'getChart' || capability === 'getRadioTracks'
  const items = new Map<string, MusicInfo | CatalogItem>()
  for (const input of data.items) {
    const item = record(input)
    const name = text(item.name)
    if (!safeId(item.id) || !name || (source === 'qs' && songs && !/^\d{1,24}$/.test(item.id))) throw new PluginError('平台插件返回的条目标识无效')
    if (!items.has(item.id)) items.set(item.id, songs
      ? normalizeSong(item, source, item.id, name) : normalizeCollection(item, source, item.id, name))
  }
  const nextCursor = typeof data.nextCursor === 'string' && data.nextCursor.length <= 8192 ? data.nextCursor : undefined
  let collection: CatalogItem | undefined
  if (capability === 'getPlaylist' || capability === 'getChart' || capability === 'getRadioTracks') {
    const item = record(data.collection)
    const name = text(item.name)
    if (!safeId(item.id) || !name) throw new PluginError('平台插件返回的集合详情无效')
    collection = normalizeCollection(item, source, item.id, name)
  }
  return { items: [...items.values()], hasMore: data.hasMore && !!nextCursor && items.size > 0, nextCursor, total: count(data.total), collection }
}
