import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { isIncompleteTrial } from '@/lib/server/audio-integrity'
import { readSourceScriptFile } from '@/lib/server/source-script-file'
import { buildUpstreamHeaders } from '@/lib/server/download-utils'
import { runSourceTestJob, type SourceTestJob } from '@/lib/server/source-test-runner'
import { publicRequest } from '@/lib/source-testing/network.cjs'
import { intervalSeconds, parseTestSamples, TEST_PLATFORMS, TEST_QUALITIES,
  type AudioFacts, type SourceTestDraft, type SourceTestResult, type TestCapability } from '@/lib/source-testing/types'
import type { SourceConfig } from '@/lib/types/music'
import { getSystemSetting } from './system-settings'
import { commitTestedSource, readConfig, SOURCE_MANAGER_CONSTANTS } from './source-manager-service'

const ASSET_ROOT = path.resolve(process.cwd(), '.cache/source-tests')
const DAY_MS = 86400000
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
type PrivateState = { filename: string; subscriptionUrl?: string; targetHash?: string }
interface NetworkResult { data: Buffer; status: number; complete: boolean; headers: Record<string, string> }
const requestPublic = publicRequest as (url: string, options: Record<string, unknown>) => Promise<NetworkResult>
const globals = globalThis as typeof globalThis & { sourceTestTasks?: Map<string, AbortController>; sourceTestLocks?: Map<string, Promise<unknown>>; sourceTestBudgets?: Map<string, number> }
const tasks = globals.sourceTestTasks ??= new Map()
const locks = globals.sourceTestLocks ??= new Map()
const budgets = globals.sourceTestBudgets ??= new Map()

export class SourceTestError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

async function locked<T>(id: string, work: () => Promise<T>): Promise<T> {
  const operation = (locks.get(id) || Promise.resolve()).catch(() => {}).then(work)
  locks.set(id, operation)
  try { return await operation } finally { if (locks.get(id) === operation) locks.delete(id) }
}

async function executeTest<T>(job: SourceTestJob, signal?: AbortSignal): Promise<T> {
  try { return await runSourceTestJob<T>(job, signal) }
  catch (error) {
    const stage = job.action === 'inspect' ? '脚本初始化失败' : job.action === 'resolve' ? '播放地址解析失败' : '音频格式解析失败'
    const reason = error instanceof Error && error.message !== '脚本初始化、取链或音频解析失败' ? `：${error.message}` : ''
    throw new SourceTestError(signal?.aborted ? '测试已取消' : stage + reason, 422)
  }
}

function capabilities(value: unknown): TestCapability {
  const raw = value as { sources?: Record<string, { qualitys?: unknown[]; actions?: unknown[] }> } | null
  const result: TestCapability = {}
  for (const platform of TEST_PLATFORMS) {
    const source = raw?.sources?.[platform]
    if (source?.actions?.includes('musicUrl')) result[platform] = TEST_QUALITIES.filter(q => source.qualitys?.includes(q))
  }
  if (!Object.keys(result).length) throw new SourceTestError('脚本没有声明支持的音乐播放平台', 422)
  return result
}

export async function loadDraft(id: string, ownerId: number): Promise<{ state: SourceTestDraft; content: string; privateState: PrivateState }> {
  if (!/^[\da-f-]{36}$/.test(id)) throw new SourceTestError('候选音源不存在', 404)
  const row = await prisma.sourceTestDraft.findFirst({ where: { id, ownerId } })
  if (!row || row.expiresAt.getTime() < Date.now()) throw new SourceTestError('测试报告不存在或已过期', 404)
  return { state: JSON.parse(row.stateJson), content: row.content, privateState: JSON.parse(row.privateJson) }
}

async function persist(state: SourceTestDraft): Promise<void> {
  await prisma.sourceTestDraft.update({ where: { id: state.id }, data: { stateJson: JSON.stringify(state) } })
}

export async function getDraft(id: string, ownerId: number): Promise<SourceTestDraft> {
  const { state } = await loadDraft(id, ownerId)
  if (state.status === 'running' && !tasks.has(id)) {
    state.status = 'interrupted'
    state.results = state.results.map(item => ['running', 'waiting'].includes(item.status) ? { ...item, status: 'cancelled', message: '服务重启，测试已中断' } : item)
    await persist(state)
  }
  state.samplesChanged = state.samplesHash !== undefined && state.samplesHash !== hash(JSON.stringify(await getSystemSetting('music.testSamples') || {}))
  return state
}

export async function recentDrafts(ownerId: number): Promise<SourceTestDraft[]> {
  const rows = await prisma.sourceTestDraft.findMany({ where: { ownerId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 10 })
  return Promise.all(rows.map(row => getDraft(row.id, ownerId)))
}

export async function createDraft(ownerId: number, input: { file?: { name: string; content: string }; url?: string; sourcePath?: string; update?: boolean }): Promise<SourceTestDraft> {
  await cleanupExpired()
  const count = await prisma.sourceTestDraft.count({ where: { ownerId, createdAt: { gt: new Date(Date.now() - DAY_MS) } } })
  if (count >= 40) throw new SourceTestError('今天创建的候选音源过多，请明天再试', 429)
  let content = input.file?.content || '', filename = input.file?.name || 'subscription.js'
  let target: SourceConfig | undefined
  let targetHash: string | undefined
  let url = input.url
  if (input.sourcePath) {
    target = (await readConfig()).sources.find(source => source.path === input.sourcePath)
    if (!target) throw new SourceTestError('原音源不存在', 404)
    const resolved = path.resolve(process.cwd(), target.path)
    if (!resolved.startsWith(path.resolve(process.cwd(), 'custom-sources') + path.sep)) throw new SourceTestError('只能测试 custom-sources 目录中的脚本')
    content = await readSourceScriptFile(resolved)
    targetHash = hash(content); filename = path.basename(resolved)
    if (input.update) {
      if (!target.subscription?.url) throw new SourceTestError('该音源没有订阅链接')
      url = target.subscription.url
    }
  }
  if (url) {
    const response = await requestPublic(url, { maxBytes: SOURCE_MANAGER_CONSTANTS.MAX_SCRIPT_SIZE, timeout: 15000 })
    if (response.status !== 200) throw new SourceTestError(`订阅下载失败：HTTP ${response.status}`, 422)
    content = response.data.toString('utf8')
    if (/^\s*(<!doctype|<html)/i.test(content)) throw new SourceTestError('订阅返回了网页，请使用脚本直链')
  }
  if (!content || Buffer.byteLength(content) > SOURCE_MANAGER_CONSTANTS.MAX_SCRIPT_SIZE || !filename.toLowerCase().endsWith('.js')) throw new SourceTestError('请选择不超过 5MB 的 JS 音源脚本')
  // Inspection is always isolated, including when normal playback has SOURCE_RUNNER_MODE=inline.
  const inspected = await executeTest<{ info: unknown; name?: string }>({ action: 'inspect', content })
  const id = randomUUID()
  const state: SourceTestDraft = { id, kind: target ? (input.update ? 'update' : 'retest') : url ? 'subscription' : 'upload',
    name: target?.name || (typeof inspected.name === 'string' && inspected.name.slice(0, 200)) || filename.replace(/\.js$/i, ''),
    hash: hash(content), capabilities: capabilities(inspected.info), target, unchanged: targetHash === hash(content),
    status: 'ready', results: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + DAY_MS).toISOString() }
  if (input.update && target) {
    const reports = await recentDrafts(ownerId)
    const previous = reports.find(report => report.hash === targetHash && report.results.length &&
      (report.target?.path === target.path || report.committedSource?.path === target.path))
    if (previous) state.previousReport = { hash: previous.hash, capabilities: previous.capabilities, results: previous.results, createdAt: previous.createdAt }
  }
  await prisma.sourceTestDraft.create({ data: { id, ownerId, content, stateJson: JSON.stringify(state),
    privateJson: JSON.stringify({ filename, subscriptionUrl: url, targetHash }), expiresAt: new Date(Date.now() + 30 * DAY_MS) } })
  return state
}

export function assessAudio(facts: AudioFacts, expectedSec: number, quality: SourceTestResult['quality'], complete: boolean): Pick<SourceTestResult, 'status' | 'message'> {
  if (facts.duration && expectedSec && isIncompleteTrial(facts.duration, expectedSec)) return { status: 'warning', message: '疑似试听片段：时长明显不足' }
  const flac = /flac/i.test(facts.codec || '')
  if ((quality === 'flac' || quality === 'flac24bit') && !flac) return { status: 'warning', message: '音质不符：返回的不是 FLAC 编码' }
  if (quality === 'flac24bit' && facts.bitsPerSample !== 24) return { status: 'warning', message: '未确认 24 bit 位深' }
  if ((quality === '320k' || quality === '128k') && facts.lossless === false && facts.bitrate && facts.bitrate < Number.parseInt(quality) * 1000 * 0.85) return { status: 'warning', message: '音质不符：实际码率明显低于请求档位' }
  if (!facts.duration || !expectedSec) return { status: 'warning', message: '已识别音频，完整时长无法判断' }
  if (Math.abs(facts.duration - expectedSec) > 30) return { status: 'warning', message: '时长与测试歌曲不符，请试听确认版本' }
  return { status: 'passed', message: complete ? '音频下载完成，编码及时长检查通过' : '编码及时长检查通过，尚未完整下载' }
}

export async function prepareTest(id: string, ownerId: number, mode: 'quick' | 'full', keys?: string[]): Promise<() => Promise<void>> {
  return locked(id, async () => {
    const draft = await loadDraft(id, ownerId)
    const { state } = draft
    if (state.status === 'committed' || Date.parse(state.expiresAt) < Date.now()) throw new SourceTestError('候选已提交或过期，请重新创建', 409)
    if (tasks.has(id) || tasks.size >= 2) throw new SourceTestError('已有测试正在执行，请稍后重试', 409)
    const samples = parseTestSamples(await getSystemSetting('music.testSamples') || {})
    const results: SourceTestResult[] = []
    for (const platform of TEST_PLATFORMS) {
      const song = samples[platform]
      if (!song) continue
      for (const quality of state.capabilities[platform] || []) {
        if (!Object.hasOwn(song._types, quality)) continue
        const key = `${platform}:${quality}`
        if (!keys || keys.includes(key)) results.push({ key, platform, quality, song, mode, status: 'waiting', message: '等待测试' })
      }
    }
    if (!results.length) throw new SourceTestError('没有可测试的组合，请先为对应平台选择具有该音质的歌曲')
    const budget = Math.min(256 * 1024 * 1024, results.length * (mode === 'full' ? 64 * 1024 * 1024 : 1024 * 1024))
    const used = await audioStorageBytes()
    if (tasks.size >= 2) throw new SourceTestError('已有测试正在执行，请稍后重试', 409)
    if (used + [...budgets.values()].reduce((sum, bytes) => sum + bytes, 0) + budget > 1024 * 1024 * 1024) throw new SourceTestError('测试音频空间不足，请在最近测试中删除不再需要的候选', 409)
    const samplesHash = hash(JSON.stringify(samples))
    state.results = keys && state.samplesHash === samplesHash ? [...state.results.filter(item => !results.some(next => next.key === item.key)), ...results] : results
    state.samplesHash = samplesHash; state.status = 'running'
    const controller = new AbortController()
    tasks.set(id, controller)
    budgets.set(id, budget)
    try { await persist(state) } catch (error) { tasks.delete(id); budgets.delete(id); throw error }
    return () => runTest(draft, results, controller)
  })
}

async function runTest(draft: Awaited<ReturnType<typeof loadDraft>>, results: SourceTestResult[], controller: AbortController): Promise<void> {
  const { state, content } = draft
  const timer = setTimeout(() => controller.abort(), 15 * 60000)
  let downloaded = 0
  try {
    await fs.mkdir(path.join(ASSET_ROOT, state.id), { recursive: true, mode: 0o700 })
    for (const result of results) {
      if (controller.signal.aborted) break
      const started = Date.now()
      result.status = 'running'; result.message = '获取地址并检查音频…'; await persist(state)
      try {
        if (downloaded >= 256 * 1024 * 1024) throw new Error('本次测试下载总量已达到 256MB 限制')
        const response = await executeTest<{ url: string }>({ action: 'resolve', content, platform: result.platform, quality: result.quality, song: result.song }, controller.signal)
        const audio = await requestPublic(response.url, { headers: buildUpstreamHeaders(response.url), signal: controller.signal, maxBytes: Math.min(result.mode === 'full' ? 64 * 1024 * 1024 : 1024 * 1024, 256 * 1024 * 1024 - downloaded), partial: true, timeout: 45000 })
        downloaded += audio.data.length
        result.bytes = audio.data.length
        result.complete = audio.complete && audio.status === 200
        if (![200, 206].includes(audio.status)) throw new Error(`音频请求失败：HTTP ${audio.status}`)
        const facts = await executeTest<AudioFacts>({ action: 'analyze', audio: audio.data.toString('base64') }, controller.signal)
        if (!facts || typeof facts.codec !== 'string') throw new Error('未能识别音频编码')
        result.facts = facts
        if (!result.complete && facts.lossless) facts.bitrate = null
        result.expectedSec = intervalSeconds(result.song.interval)
        Object.assign(result, assessAudio(facts, result.expectedSec, result.quality, result.complete))
        if (result.mode === 'full' && !result.complete) { result.status = 'warning'; result.message = '超过大小限制或仅返回部分音频，完整检查未完成' }
        await fs.writeFile(assetPath(state.id, result.key), audio.data, { mode: 0o600 })
        result.asset = true
      } catch (error) {
        result.status = controller.signal.aborted ? 'cancelled' : 'failed'
        // Script errors may contain signed URLs: never expose raw upstream messages.
        result.message = error instanceof SourceTestError ? error.message : controller.signal.aborted ? '测试已取消' : '音频检查失败、超时或被网络策略阻止'
      }
      result.elapsedMs = Date.now() - started; result.testedAt = new Date().toISOString()
      await persist(state)
    }
    state.status = controller.signal.aborted ? 'cancelled' : 'completed'
    for (const item of state.results) if (['waiting', 'running'].includes(item.status)) { item.status = 'cancelled'; item.message = '测试已取消' }
    await persist(state)
  } catch (error) {
    state.status = 'interrupted'
    await persist(state).catch(() => {})
    logger.warn('[source-test] 测试任务中断', { id: state.id, error: error instanceof Error ? error.name : 'unknown' })
  } finally { clearTimeout(timer); tasks.delete(state.id); budgets.delete(state.id) }
}

export async function cancelTest(id: string, ownerId: number): Promise<void> {
  await loadDraft(id, ownerId)
  tasks.get(id)?.abort()
}

function assetPath(id: string, key: string): string {
  if (!/^[\da-f-]{36}$/.test(id) || !/^(tx|wy|kg|kw|mg):(flac24bit|flac|320k|128k)$/.test(key)) throw new SourceTestError('音频不存在', 404)
  return path.join(ASSET_ROOT, id, key.replace(':', '-') + '.audio')
}

export async function getAsset(id: string, ownerId: number, key: string): Promise<{ file: string; codec: string }> {
  const { state } = await loadDraft(id, ownerId)
  const item = state.results.find(result => result.key === key)
  if (!item?.asset || Date.parse(state.expiresAt) < Date.now()) throw new SourceTestError('试听音频已过期，请重新测试', 404)
  return { file: assetPath(id, key), codec: item.facts?.codec || '' }
}

export async function commitDraft(id: string, ownerId: number, options: { pt: string[]; enabled: boolean; priority?: number }): Promise<SourceConfig> {
  return locked(id, async () => {
    const { state, content, privateState } = await loadDraft(id, ownerId)
    if (state.committedSource) return state.committedSource
    if (tasks.has(id) || Date.parse(state.expiresAt) < Date.now()) throw new SourceTestError('请等待测试结束，或重新创建已过期的候选', 409)
    if (!Array.isArray(options.pt) || options.pt.some(p => !Object.hasOwn(state.capabilities, p)) ||
      typeof options.enabled !== 'boolean' || (options.enabled && !options.pt.length) ||
      (options.priority !== undefined && !Number.isFinite(options.priority))) throw new SourceTestError('请选择有效的启用平台')
    if (options.enabled && !state.results.some(result => result.status === 'passed' || result.status === 'warning')) throw new SourceTestError('请先完成音频测试，或仅保存为停用音源')
    if (hash(content) !== state.hash) throw new SourceTestError('候选脚本已变更，请重新测试', 409)
    const source = await commitTestedSource({ id, content, filename: privateState.filename, name: state.name, ...options,
      target: state.target, targetHash: privateState.targetHash, subscriptionUrl: privateState.subscriptionUrl })
    state.status = 'committed'; state.committedSource = source
    await persist(state)
    return source
  })
}

export async function discardDraft(id: string, ownerId: number): Promise<void> {
  return locked(id, async () => {
    await loadDraft(id, ownerId)
    if (tasks.has(id)) throw new SourceTestError('请先停止测试，再删除候选', 409)
    await prisma.sourceTestDraft.delete({ where: { id } })
    await fs.rm(path.join(ASSET_ROOT, id), { recursive: true, force: true })
  })
}

async function cleanupExpired(): Promise<void> {
  await prisma.sourceTestDraft.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  const entries = await fs.readdir(ASSET_ROOT, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\da-f-]{36}$/.test(entry.name) || tasks.has(entry.name)) continue
    const directory = path.join(ASSET_ROOT, entry.name)
    const stat = await fs.stat(directory)
    if (stat.mtimeMs < Date.now() - DAY_MS) await fs.rm(directory, { recursive: true, force: true })
  }
}

async function audioStorageBytes(): Promise<number> {
  let bytes = 0
  const entries = await fs.readdir(ASSET_ROOT, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\da-f-]{36}$/.test(entry.name)) continue
    const directory = path.join(ASSET_ROOT, entry.name)
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      if (file.isFile()) bytes += (await fs.stat(path.join(directory, file.name))).size
    }
  }
  return bytes
}
