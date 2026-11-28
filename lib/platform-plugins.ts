import type { SourceType } from '@/lib/types/music'

export const PLATFORM_IDS = ['tx', 'wy', 'kw', 'kg', 'mg', 'qs'] as const
export const BUILTIN_PLATFORM_IDS = ['tx', 'wy', 'kw', 'kg', 'mg'] as const
export const PLATFORM_NAMES: Record<string, string> = { tx: 'QQ 音乐', wy: '网易云音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐', qs: '汽水音乐' }
export const PLUGIN_CAPABILITIES = {
  searchSongs: '单曲搜索', searchPlaylists: '歌单搜索', listPlaylistCategories: '歌单分类', listPlaylists: '推荐歌单',
  getPlaylist: '歌单详情', listCharts: '榜单列表', getChart: '榜单详情', listRadioStations: '漫游电台', getRadioTracks: '漫游曲目',
} as const

export type PluginCapability = keyof typeof PLUGIN_CAPABILITIES
export const CAPABILITY_IDS = Object.keys(PLUGIN_CAPABILITIES) as PluginCapability[]
export const MAX_PLUGIN_BYTES = 256 * 1024

export interface PluginPlatform {
  id: SourceType
  name: string
  origins: string[]
  capabilities: PluginCapability[]
}

export interface PluginManifest {
  apiVersion: 1
  id: string
  name: string
  version: string
  platforms: PluginPlatform[]
}

export interface PublicPlatform {
  id: SourceType
  name: string
  capabilities: PluginCapability[]
  pluginCapabilities?: PluginCapability[]
  playable?: boolean
}

export interface PluginInput {
  keyword?: string
  categoryId?: string
  id?: string
  cursor?: string
  limit?: number
}

export interface PluginSelection {
  platform: string
  capability: PluginCapability
}

export const platformCapabilityKey = (platform: string, capability: PluginCapability): string => `${platform}:${capability}`
export const isPlatformId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9]{0,15}$/.test(value) && value !== 'all'
export const isCapability = (value: unknown): value is PluginCapability => typeof value === 'string' && Object.hasOwn(PLUGIN_CAPABILITIES, value)

export const BUILTIN_PLATFORMS: PublicPlatform[] = BUILTIN_PLATFORM_IDS.map(id => ({
  id, name: PLATFORM_NAMES[id], capabilities: ['searchSongs', 'searchPlaylists', 'listPlaylistCategories', 'listPlaylists', 'getPlaylist', 'listCharts', 'getChart'],
}))

// Names reported by /api/platforms, so plugin platforms without a built-in short name can still be labelled.
let knownNames: Record<string, string> = {}
export const rememberPlatformNames = (items: PublicPlatform[]): void => { knownNames = Object.fromEntries(items.map(item => [item.id, item.name])) }
export const knownPlatformName = (id: string): string | undefined => knownNames[id]
