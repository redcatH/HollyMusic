import { createHash } from 'node:crypto'
import { searchCache } from '@/lib/cache-manager'
import { getStorageSongmidForMusicInfo, prisma, upsertMusicInfosInTransaction } from '@/lib/db'
import { BUILTIN_PLATFORMS, isCapability, type PluginCapability, type PluginInput, type PluginManifest, type PublicPlatform } from '@/lib/platform-plugins'
import { parseCatalogPage, PluginError, type CatalogPage } from '@/lib/server/platform-plugin-contract'
import { runSourceTestJob } from '@/lib/server/source-test-runner'
import type { MusicInfo, Song } from '@/lib/types/music'

export async function getPublicPlatforms(): Promise<PublicPlatform[]> {
  const bindings = await prisma.platformPluginBinding.findMany({ where: { revisionId: { not: null } }, orderBy: { platform: 'asc' } })
  if (!bindings.length) return BUILTIN_PLATFORMS
  const revisions = await prisma.platformPluginRevision.findMany({ where: { id: { in: bindings.flatMap(b => b.revisionId ? [b.revisionId] : []) } },
    select: { id: true, manifestJson: true } })
  const manifests = new Map(revisions.map(row => [row.id, JSON.parse(row.manifestJson) as PluginManifest]))
  const result = new Map(BUILTIN_PLATFORMS.map(item => [item.id, { ...item, capabilities: [...item.capabilities], pluginCapabilities: [] as PluginCapability[] }]))
  for (const binding of bindings) {
    if (!binding.revisionId || !isCapability(binding.capability)) continue
    const platform = manifests.get(binding.revisionId)?.platforms.find(item => item.id === binding.platform)
    if (!platform) continue
    const current = result.get(platform.id) ?? { id: platform.id, name: platform.name, capabilities: [], pluginCapabilities: [] }
    current.pluginCapabilities.push(binding.capability)
    if (!current.capabilities.includes(binding.capability)) current.capabilities.push(binding.capability)
    result.set(platform.id, current)
  }
  return [...result.values()]
}

const pending = new Map<string, Promise<CatalogPage>>()
const CATALOG_CACHE_MS = 5 * 60_000
const RECOMMEND_CACHE_MS = 45_000
const MAX_PAGE_WALK = 8

export async function getPluginBinding(platform: string, capability: PluginCapability): Promise<string | null> {
  const binding = await prisma.platformPluginBinding.findUnique({ where: { platform_capability: { platform, capability } }, select: { revisionId: true } })
  return binding?.revisionId ?? null
}

export async function getPluginSearchBindings(): Promise<Map<string, string>> {
  const bindings = await prisma.platformPluginBinding.findMany({ where: { capability: 'searchSongs', revisionId: { not: null } },
    orderBy: { platform: 'asc' }, select: { platform: true, revisionId: true } })
  return new Map(bindings.flatMap(item => item.revisionId ? [[item.platform, item.revisionId] as const] : []))
}

function catalogKey(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export async function getPluginPage(platform: string, capability: PluginCapability, input: PluginInput,
  page = 1, revision?: string | null, continuation?: string, refresh = false): Promise<(CatalogPage & { revision: string; continuation?: string }) | null> {
  const id = revision === undefined ? await getPluginBinding(platform, capability) : revision
  if (!id) return null
  const limit = input.limit ?? 30
  const params = { ...input, limit, cursor: undefined }
  const base = `search:platform-plugin:${platform}:${capability}:${id}:${catalogKey(params)}`
  const tokenPrefix = `${id}.${catalogKey(params)}.`
  let cursor: string | undefined
  let current = 1
  if (continuation) {
    if (!continuation.startsWith(tokenPrefix)) throw new PluginError('平台内容已变更，请从第一页重新加载', 409)
    cursor = searchCache.get(`${base}:cursor:${continuation}`) as string | undefined
    if (!cursor) throw new PluginError('续页已过期，请从第一页重新加载', 409)
    current = page
  } else if (page > MAX_PAGE_WALK) throw new PluginError('请从上一页继续加载')

  const ttl = capability === 'listPlaylists' || capability === 'getRadioTracks' ? RECOMMEND_CACHE_MS : CATALOG_CACHE_MS
  let found: CatalogPage | undefined
  while (current <= page) {
    const requestInput = { ...params, cursor }
    const key = `${base}:${catalogKey(cursor ?? '')}`
    const cached = (refresh && current === page ? null : searchCache.get(key)) as CatalogPage | null
    let operation = pending.get(key)
    if (!cached && !operation) {
      operation = load().finally(() => pending.delete(key))
      pending.set(key, operation)
    }
    found = cached ?? await operation!
    if (current === page) break
    if (!found.hasMore || found.nextCursor === cursor) return { items: [], hasMore: false, revision: id }
    cursor = found.nextCursor
    current++

    async function load(): Promise<CatalogPage> {
      const stored = await prisma.platformPluginRevision.findUnique({ where: { id: id! }, select: { content: true, manifestJson: true } })
      if (!stored) throw new PluginError('平台插件版本已移除，请刷新页面', 409)
      const manifest: PluginManifest = JSON.parse(stored.manifestJson)
      const provider = manifest.platforms.find(item => item.id === platform && item.capabilities.includes(capability))
      if (!provider) throw new PluginError('平台功能暂不可用', 503)
      let raw: unknown
      try {
        raw = await runSourceTestJob({ action: 'platformCall', content: stored.content, platform, capability,
          input: requestInput, origins: provider.origins }, undefined, 12000)
      } catch (error) {
        throw new PluginError(error instanceof Error ? error.message : '平台插件请求失败', 502)
      }
      const parsed = parseCatalogPage(raw, capability, platform, limit)
      searchCache.set(key, parsed, ttl)
      return parsed
    }
  }
  if (!found) return { items: [], hasMore: false, revision: id }
  const hasMore = found.hasMore && found.nextCursor !== cursor
  const next = hasMore && found.nextCursor ? tokenPrefix + catalogKey(found.nextCursor) : undefined
  if (next) searchCache.set(`${base}:cursor:${next}`, found.nextCursor, CATALOG_CACHE_MS)
  return { ...found, hasMore, revision: id, continuation: next }
}

export async function persistPluginSongs(items: MusicInfo[]): Promise<Song[]> {
  const writes = await upsertMusicInfosInTransaction(items, { preserveQualities: true })
  return items.map((song, index) => ({
    ...song,
    ...writes[index]?.preservedQualities,
    uid: `${song.source}-${getStorageSongmidForMusicInfo(song)}`,
  }))
}
