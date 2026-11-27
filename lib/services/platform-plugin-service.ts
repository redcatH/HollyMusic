import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma'
import { MAX_PLUGIN_BYTES, isCapability, isPlatformId, platformCapabilityKey, type PluginManifest, type PluginSelection, type PluginInput } from '@/lib/platform-plugins'
import type { PluginAdminView, PluginChangeView, PluginDeletionView, PluginImportResult, PluginRevisionView, PluginTestResult } from '@/lib/platform-plugin-admin'
import { parseCatalogPage, parseManifest, PluginError, record, safeId } from '@/lib/server/platform-plugin-contract'
import { runSourceTestJob } from '@/lib/server/source-test-runner'

function revisionView(revision: { id: string; manifestJson: string; testsJson: string }): PluginRevisionView {
  return { id: revision.id, manifest: JSON.parse(revision.manifestJson), tests: JSON.parse(revision.testsJson) }
}

function readDeletion(requestJson: string): PluginDeletionView | undefined {
  return (JSON.parse(requestJson) as { deletion?: PluginDeletionView })?.deletion
}

export async function getPluginAdminView(): Promise<PluginAdminView> {
  const [revisions, bindings, changes] = await Promise.all([
    prisma.platformPluginRevision.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, manifestJson: true, testsJson: true } }),
    prisma.platformPluginBinding.findMany({ orderBy: [{ platform: 'asc' }, { capability: 'asc' }] }),
    prisma.platformPluginChange.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
  ])
  return {
    revisions: revisions.map(revisionView),
    bindings: bindings.flatMap(({ platform, capability, revisionId }) => isCapability(capability) ? [{ platform, capability, revisionId }] : []),
    changes: changes.map(row => ({
      id: row.id, createdAt: row.createdAt.toISOString(), changes: JSON.parse(row.changesJson),
      deletion: readDeletion(row.requestJson),
    })),
  }
}

export async function uploadPlatformPlugin(content: string, ownerId: number, signal?: AbortSignal): Promise<PluginImportResult> {
  if (!content.trim() || Buffer.byteLength(content) > MAX_PLUGIN_BYTES) throw new PluginError('脚本为空或超过 256 KB')
  let raw: unknown
  try { raw = await runSourceTestJob({ action: 'platformInspect', content }, signal, 5000) }
  catch (error) { throw new PluginError(error instanceof Error ? error.message : '脚本预检失败') }
  const manifest = parseManifest(raw)
  const digest = createHash('sha256').update(content).digest('hex')
  const declared = new Set(manifest.platforms.flatMap(({ id, capabilities }) =>
    capabilities.map(capability => platformCapabilityKey(id, capability))))

  return prisma.$transaction(async tx => {
    const revision = await tx.platformPluginRevision.upsert({
      where: { packageId_version: { packageId: manifest.id, version: manifest.version } },
      create: { id: randomUUID(), packageId: manifest.id, version: manifest.version, digest, content, manifestJson: JSON.stringify(manifest), ownerId },
      update: {},
    })
    if (revision.digest !== digest) throw new PluginError('同一包的版本号已对应其他脚本，请更新版本号', 409)

    const packageRevisions = await tx.platformPluginRevision.findMany({ where: { packageId: manifest.id }, select: { id: true } })
    const revisionIds = new Set(packageRevisions.map(item => item.id))
    const bindings = await tx.platformPluginBinding.findMany({ where: { revisionId: { not: null } } })
    const active = new Map(bindings.map(item => [`${item.platform}:${item.capability}`, item.revisionId]))
    const conflicts: PluginSelection[] = []
    const changes: PluginChangeView[] = []
    let activeCount = 0

    for (const { id: platform, capabilities } of manifest.platforms) {
      for (const capability of capabilities) {
        const before = active.get(platformCapabilityKey(platform, capability)) ?? null
        const listProvider = capability === 'listPlaylistCategories' ? active.get(platformCapabilityKey(platform, 'listPlaylists')) : null
        if ((before && !revisionIds.has(before)) || (listProvider && !revisionIds.has(listProvider))) {
          conflicts.push({ platform, capability })
          continue
        }
        activeCount++
        if (before !== revision.id) changes.push({ platform, capability, before, after: revision.id })
      }
    }
    for (const { platform, capability, revisionId: before } of bindings) {
      if (before && revisionIds.has(before) && isCapability(capability) && !declared.has(platformCapabilityKey(platform, capability))) {
        changes.push({ platform, capability, before, after: null })
      }
    }

    if (changes.length) {
      await writePluginBindingChanges(tx, changes, {
        id: randomUUID(), requestJson: JSON.stringify({ importRevisionId: revision.id }), ownerId,
      })
    }
    return { revision: revisionView(revision), activeCount, conflicts }
  })
}

function readSelection(data: unknown): PluginSelection {
  const { platform, capability } = record(data)
  if (!isPlatformId(platform) || !isCapability(capability)) throw new PluginError('平台或功能无效')
  return { platform, capability }
}

export async function testPlatformPlugin(data: Record<string, unknown>, signal?: AbortSignal): Promise<PluginTestResult> {
  const { platform, capability } = readSelection(data)
  if (!safeId(data.revisionId)) throw new PluginError('插件版本无效')
  const revision = await prisma.platformPluginRevision.findUnique({ where: { id: data.revisionId } })
  if (!revision) throw new PluginError('找不到插件版本', 404)
  const manifest: PluginManifest = JSON.parse(revision.manifestJson)
  const provider = manifest.platforms.find(p => p.id === platform && p.capabilities.includes(capability))
  if (!provider) throw new PluginError('此版本未声明对应功能')
  const input: PluginInput = { limit: 12 }
  if (capability === 'searchSongs' || capability === 'searchPlaylists') {
    if (typeof data.sample !== 'string' || !data.sample.trim() || data.sample.length > 100) throw new PluginError('请输入测试关键词')
    input.keyword = data.sample.trim()
  }
  if (capability === 'getPlaylist' || capability === 'getChart' || capability === 'getRadioTracks') {
    if (!safeId(data.sample)) throw new PluginError('请输入有效的歌单、榜单或电台 ID')
    input.id = data.sample
  }
  let result: PluginTestResult = { ok: false, testedAt: new Date().toISOString() }
  try {
    const raw = await runSourceTestJob({ action: 'platformCall', content: revision.content, platform, capability, input, origins: provider.origins }, signal, 12000)
    const page = parseCatalogPage(raw, capability, platform, input.limit!)
    const first = page.items[0]
    if (!first) throw new PluginError('测试样本未返回条目，请更换样本')
    result = { ...result, ok: true, count: page.items.length, sampleId: 'songmid' in first ? first.songmid : first.id }
  } catch (error) {
    result.message = error instanceof Error ? error.message : '测试失败'
  }
  const key = platformCapabilityKey(platform, capability)
  await prisma.$transaction(async tx => {
    const current = await tx.platformPluginRevision.findUnique({ where: { id: revision.id }, select: { testsJson: true } })
    if (!current) throw new PluginError('插件版本已删除', 404)
    await tx.platformPluginRevision.update({ where: { id: revision.id }, data: { testsJson: JSON.stringify({ ...JSON.parse(current.testsJson), [key]: result }) } })
  })
  return result
}

export async function deletePlatformPlugin(data: Record<string, unknown>, ownerId: number): Promise<{ deleted: number }> {
  const { revisionId, scope } = data
  if (!safeId(revisionId) || (scope !== 'revision' && scope !== 'package')) throw new PluginError('请选择要删除的插件')

  return prisma.$transaction(async tx => {
    const revision = await tx.platformPluginRevision.findUnique({
      where: { id: revisionId },
      select: { id: true, packageId: true, version: true, manifestJson: true },
    })
    if (!revision) return { deleted: 0 }

    const revisions = scope === 'package'
      ? await tx.platformPluginRevision.findMany({ where: { packageId: revision.packageId }, select: { id: true } })
      : [revision]
    const ids = revisions.map(item => item.id)
    const bindingFilter = { revisionId: { in: ids } }
    const bindings = await tx.platformPluginBinding.findMany({ where: bindingFilter })
    const changes = bindings.flatMap(({ platform, capability, revisionId }) =>
      isCapability(capability) ? [{ platform, capability, before: revisionId, after: null }] : [])
    await tx.platformPluginBinding.updateMany({ where: bindingFilter, data: { revisionId: null } })
    await tx.platformPluginRevision.deleteMany({ where: { id: { in: ids } } })
    const manifest: PluginManifest = JSON.parse(revision.manifestJson)
    const deletion: PluginDeletionView = {
      name: manifest.name,
      version: scope === 'revision' ? revision.version : undefined,
      revisionCount: ids.length,
    }
    await tx.platformPluginChange.create({
      data: { id: randomUUID(), requestJson: JSON.stringify({ deletion }), changesJson: JSON.stringify(changes), ownerId },
    })
    return { deleted: ids.length }
  })
}

function parseChanges(raw: unknown): PluginChangeView[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 144) throw new PluginError('请选择需要修改的平台功能')
  const keys = new Set<string>()
  return raw.map(value => {
    const data = record(value)
    const selection = readSelection(data)
    const key = platformCapabilityKey(selection.platform, selection.capability)
    if (keys.has(key)) throw new PluginError('同一平台功能重复提交')
    keys.add(key)
    if ((data.before !== null && !safeId(data.before)) || (data.after !== null && !safeId(data.after))) throw new PluginError('版本标识无效')
    return { ...selection, before: data.before, after: data.after }
  })
}

export async function changePluginBindings(data: Record<string, unknown>, ownerId: number): Promise<PluginChangeView[]> {
  if (!safeId(data.requestId)) throw new PluginError('缺少操作标识')
  const operationId = data.requestId
  const originalId = typeof data.rollbackId === 'string' && safeId(data.rollbackId) ? data.rollbackId : null
  const proposed = originalId ? null : parseChanges(data.changes)
  const requestJson = JSON.stringify(originalId ? { rollbackId: originalId } : proposed)
  return prisma.$transaction(async tx => {
    const existing = await tx.platformPluginChange.findUnique({ where: { id: operationId } })
    if (existing) {
      if (existing.requestJson !== requestJson) throw new PluginError('操作标识已使用', 409)
      return JSON.parse(existing.changesJson) as PluginChangeView[]
    }
    const original = originalId ? await tx.platformPluginChange.findUnique({ where: { id: originalId } }) : null
    if (originalId && !original) throw new PluginError('找不到要回滚的记录', 404)
    if (original && readDeletion(original.requestJson)) throw new PluginError('删除记录无法回滚，请重新导入脚本', 409)
    const rollback = original && (JSON.parse(original.changesJson) as PluginChangeView[]).map(item => ({ ...item, before: item.after, after: item.before }))
    const changes = (proposed ?? rollback ?? []).filter(item => item.before !== item.after)
    if (!changes.length) return []

    const revisionIds = [...new Set(changes.flatMap(item => item.after ? [item.after] : []))]
    const revisions = await tx.platformPluginRevision.findMany({
      where: { id: { in: revisionIds } }, select: { id: true, manifestJson: true },
    })
    const manifests = new Map(revisions.map(item => [item.id, JSON.parse(item.manifestJson) as PluginManifest]))
    if (original && revisions.length !== revisionIds.length) throw new PluginError('回滚所需的插件版本已删除', 409)
    for (const { platform, capability, after } of changes) {
      if (after && !manifests.get(after)?.platforms.some(item => item.id === platform && item.capabilities.includes(capability))) {
        throw new PluginError('此版本未声明对应功能')
      }
    }
    await writePluginBindingChanges(tx, changes, { id: operationId, requestJson, ownerId })
    return changes
  })
}

async function writePluginBindingChanges(tx: Prisma.TransactionClient, changes: PluginChangeView[],
  operation: { id: string; requestJson: string; ownerId: number }): Promise<void> {
  for (const { platform, capability, before, after } of changes) {
    const where = { platform_capability: { platform, capability } }
    const current = await tx.platformPluginBinding.findUnique({ where })
    if ((current?.revisionId ?? null) !== before) throw new PluginError('当前功能版本已变更，请刷新后台', 409)
    await tx.platformPluginBinding.upsert({ where, create: { platform, capability, revisionId: after }, update: { revisionId: after } })
  }

  const playlistPlatforms = [...new Set(changes.filter(item => item.capability === 'listPlaylists'
    || item.capability === 'listPlaylistCategories').map(item => item.platform))]
  if (playlistPlatforms.length) {
    const bindings = await tx.platformPluginBinding.findMany({ where: {
      platform: { in: playlistPlatforms },
      capability: { in: ['listPlaylists', 'listPlaylistCategories'] }, revisionId: { not: null },
    } })
    for (const item of bindings) {
      if (item.capability === 'listPlaylistCategories' && !bindings.some(list => list.platform === item.platform
        && list.capability === 'listPlaylists' && list.revisionId === item.revisionId)) {
        throw new PluginError('歌单分类须与同版本的推荐歌单一起启用，或先停用分类', 409)
      }
    }
  }
  await tx.platformPluginChange.create({ data: { ...operation, changesJson: JSON.stringify(changes) } })
}
