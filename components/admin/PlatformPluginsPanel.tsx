import { useEffect, useState } from 'react'
import { Check, Plug, RotateCcw, Trash2, Upload } from 'lucide-react'
import { usePlatforms } from '@/hooks/usePlatforms'
import { applyPluginChanges, deletePlugin, getPluginAdmin, rollbackPluginChanges, testPlugin, uploadPlugin } from '@/lib/api/platforms'
import { MAX_PLUGIN_BYTES, PLUGIN_CAPABILITIES, platformCapabilityKey } from '@/lib/platform-plugins'
import type { PluginCapability } from '@/lib/platform-plugins'
import type { PluginAdminView, PluginChangeView, PluginDeletionScope } from '@/lib/platform-plugin-admin'

const buttonClass = 'rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50'
const detailTestSources: Partial<Record<PluginCapability, readonly PluginCapability[]>> = {
  getPlaylist: ['listPlaylists', 'searchPlaylists'],
  getChart: ['listCharts'],
  getRadioTracks: ['listRadioStations'],
}

export function PlatformPluginsPanel({ onOpenSources }: { onOpenSources: () => void }) {
  const platformStatus = usePlatforms()
  const [view, setView] = useState<PluginAdminView>()
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [revisionId, setRevisionId] = useState('')
  const [samples, setSamples] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const revision = view?.revisions.find(item => item.id === revisionId) ?? view?.revisions[0]
  const names = new Map(view?.revisions.map(item => [item.id, `${item.manifest.name} v${item.manifest.version}`]))
  const packageRevisionCount = view?.revisions.filter(item => item.manifest.id === revision?.manifest.id).length ?? 0

  useEffect(() => {
    const controller = new AbortController()
    void getPluginAdmin(controller.signal).then(data => {
      if (!controller.signal.aborted) setView(data)
    }).catch(err => {
      if (!controller.signal.aborted) {
        setLoadError(err instanceof Error ? err.message || '读取平台插件失败' : '读取平台插件失败')
      }
    })
    return () => controller.abort()
  }, [loadAttempt])

  function retryLoad() {
    setLoadError('')
    setLoadAttempt(previous => previous + 1)
  }

  async function perform(action: () => Promise<string | void>, changed = false) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const message = await action()
      if (message) setNotice(message)
      if (changed) window.dispatchEvent(new Event('platform-plugins-changed'))
      setView(await getPluginAdmin())
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败') }
    finally { setBusy(false) }
  }

  const activeRevision = (platform: string, capability: PluginCapability) =>
    view?.bindings.find(item => item.platform === platform && item.capability === capability)?.revisionId ?? null

  function changesForSelection(): PluginChangeView[] {
    if (!revision) return []
    return revision.manifest.platforms.flatMap(platform => platform.capabilities.filter(capability => selected.includes(platformCapabilityKey(platform.id, capability)))
      .map(capability => ({ platform: platform.id, capability, before: activeRevision(platform.id, capability), after: revision.id })))
  }

  async function apply(changes: PluginChangeView[]) {
    if (!changes.length) return
    if (changes.some(item => item.before && item.before !== item.after) && !window.confirm('确认切换所选平台功能的当前版本？')) return
    await perform(async () => {
      await applyPluginChanges(changes)
      setSelected([])
      return '平台功能已更新'
    }, true)
  }

  async function remove(scope: PluginDeletionScope) {
    if (!revision) return
    const target = scope === 'package' ? revision.manifest.name : names.get(revision.id)
    const contents = scope === 'package' ? `此操作会删除全部 ${packageRevisionCount} 个版本` : '此操作会删除所选版本'
    if (!window.confirm(`确定删除「${target}」？${contents}，并停用由这些版本提供的功能。删除后不可回滚。`)) return
    await perform(async () => {
      const { deleted } = await deletePlugin(revision.id, scope)
      setRevisionId('')
      setSelected([])
      setSamples({})
      return deleted ? `已删除 ${target}` : '所选插件已移除'
    }, true)
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">平台插件</h2><p className="mt-1 text-sm text-muted-foreground">导入脚本即可启用搜索和发现功能。播放可在音源管理配置。</p></div>
      <label className={`${buttonClass} inline-flex items-center gap-2 ${busy || !view ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}><Upload className="h-4 w-4" /> 导入脚本
        <input type="file" accept=".js,text/javascript" className="sr-only" disabled={busy || !view} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (!file.name.toLowerCase().endsWith('.js') || file.size > MAX_PLUGIN_BYTES) { setError('请选择不超过 256 KB 的 .js 文件'); return }
          void perform(async () => {
            const { revision: imported, activeCount, conflicts } = await uploadPlugin(file)
            setRevisionId(imported.id)
            setSelected([])
            setSamples({})
            const summary = `已导入 ${imported.manifest.name}，${activeCount} 项功能已启用`
            return conflicts.length ? `${summary}，${conflicts.length} 项存在提供方冲突` : summary
          }, true)
        }} />
      </label>
    </div>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {!view ? (
      loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <button type="button" className={buttonClass} onClick={retryLoad}>重试</button>
        </div>
      ) : <p className="text-sm text-muted-foreground" role="status">正在读取插件</p>
    ) : <>
      {!revision ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground"><Plug className="mx-auto mb-2 h-6 w-6" />暂无插件。可导入包含一个或多个平台的脚本。</div> : <>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="插件版本" value={revision.id} disabled={busy} className="min-w-0 max-w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            onChange={event => { setRevisionId(event.target.value); setSelected([]); setSamples({}) }}>
            {view.revisions.map(item => <option key={item.id} value={item.id}>{names.get(item.id)}</option>)}
          </select>
          <button type="button" className={`${buttonClass} bg-primary text-primary-foreground`} disabled={busy || !selected.length} onClick={() => void apply(changesForSelection())}>启用所选功能</button>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {packageRevisionCount > 1 && <button type="button" className={`${buttonClass} text-destructive`} disabled={busy}
              onClick={() => void remove('revision')}>删除此版本</button>}
            <button type="button" className={`${buttonClass} inline-flex items-center gap-1.5 text-destructive`} disabled={busy}
              onClick={() => void remove('package')}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> 删除插件</button>
          </div>
        </div>
        {revision.manifest.platforms.map(platform => <div key={platform.id} className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">{platform.name} <span className="text-xs font-normal text-muted-foreground">{platform.id}</span></h3>
          {platformStatus.find(item => item.id === platform.id)?.playable === true && <p className="mt-1 text-xs text-muted-foreground">已匹配播放音源</p>}
          {platformStatus.find(item => item.id === platform.id)?.playable === false && <p className="mt-1 text-xs text-muted-foreground">可浏览 · 暂无可用播放音源 <button type="button" onClick={onOpenSources} className="text-primary hover:underline">配置音源</button></p>}
          {platform.origins.length > 0 && <p className="my-2 break-all text-xs text-muted-foreground">{platform.origins.join(' · ')}</p>}
          <ul aria-label={`${platform.name}功能`} className="mt-3 flex flex-wrap gap-2">
            {platform.capabilities.map(capability => {
              const key = platformCapabilityKey(platform.id, capability)
              const active = activeRevision(platform.id, capability)
              const enabled = active === revision.id
              const label = PLUGIN_CAPABILITIES[capability]
              return <li key={key} className={`flex min-h-8 max-w-full items-center gap-2 rounded-lg border px-2.5 text-xs ${enabled ? 'border-primary/25 bg-primary/5' : 'border-border bg-background/50'}`}>
                {enabled ? <>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{label}<span className="sr-only">已启用</span>
                  </span>
                  <button type="button" className="border-l border-border/80 py-1 pl-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
                    aria-label={`停用${platform.name}${label}`} disabled={busy}
                    onClick={() => void apply([{ platform: platform.id, capability, before: active, after: null }])}>停用</button>
                </> : <>
                  <label className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
                    <input type="checkbox" aria-label={`选择${platform.name}${label}`}
                      disabled={busy} checked={selected.includes(key)}
                      onChange={event => setSelected(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))} />{label}
                  </label>
                  <span className="truncate text-muted-foreground" title={active ? `由 ${names.get(active) ?? '其他版本'} 提供` : undefined}>
                    {active ? '其他版本启用' : '未启用'}
                  </span>
                </>}
              </li>
            })}
          </ul>
          <details key={revision.id} className="mt-2 border-t border-border/60 pt-3">
            <summary className="cursor-pointer text-sm font-medium">功能测试（可选）</summary>
            <ul className="mt-2 divide-y divide-border/60">
              {platform.capabilities.map(capability => {
                const key = platformCapabilityKey(platform.id, capability)
                const tested = revision.tests[key]
                const search = capability === 'searchSongs' || capability === 'searchPlaylists'
                const listCapabilities = detailTestSources[capability]
                const savedSample = listCapabilities?.map(item => revision.tests[platformCapabilityKey(platform.id, item)]?.sampleId).find(Boolean)
                const sample = samples[key] ?? savedSample ?? ''
                return <li key={key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-28">{PLUGIN_CAPABILITIES[capability]}</span>
                  <span className="mr-auto text-xs text-muted-foreground">
                    {tested ? tested.ok ? `测试通过，${tested.count} 项` : tested.message : '未测试'}
                  </span>
                  {(search || listCapabilities) && <input aria-label={`${platform.name}${PLUGIN_CAPABILITIES[capability]}测试样本`}
                    placeholder={search ? '测试关键词' : '条目 ID'} value={sample} disabled={busy}
                    onChange={event => setSamples(previous => ({ ...previous, [key]: event.target.value }))}
                    className="w-36 rounded-md border border-border bg-background px-2 py-1 text-xs" />}
                  <button type="button" className={buttonClass} disabled={busy || ((search || !!listCapabilities) && !sample.trim())}
                    aria-label={`测试${platform.name}${PLUGIN_CAPABILITIES[capability]}`}
                    onClick={() => void perform(async () => { await testPlugin(revision.id, platform.id, capability, sample.trim()) })}>测试</button>
                </li>
              })}
            </ul>
            {platform.capabilities.some(capability => detailTestSources[capability]?.some(source => platform.capabilities.includes(source))) &&
              <p className="text-xs text-muted-foreground">先测试对应列表，可自动填入详情测试所需的条目 ID。</p>}
          </details>
        </div>)}
      </>}
      {view.changes.length > 0 && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-medium">变更记录</summary>
        <ul className="mt-2 space-y-2">{view.changes.map(change => {
          const missingRevision = change.changes.some(item => item.before && !names.has(item.before))
          const deletion = change.deletion
          return <li key={change.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-words">{new Date(change.createdAt).toLocaleString()} · {deletion
              ? `删除 ${deletion.name}${deletion.version ? ` v${deletion.version}` : `（${deletion.revisionCount} 个版本）`}`
              : change.changes.map(item => `${item.platform} ${PLUGIN_CAPABILITIES[item.capability]}`).join('、')}</span>
            {!deletion && <button type="button" className={`${buttonClass} inline-flex shrink-0 items-center gap-1`}
              disabled={busy || missingRevision || change.changes.some(item => activeRevision(item.platform, item.capability) !== item.after)}
              title={missingRevision ? '回滚所需的插件版本已删除' : undefined}
              onClick={() => {
                if (window.confirm('回滚这次变更？')) void perform(async () => {
                  await rollbackPluginChanges(change.id)
                  return '已回滚'
                }, true)
              }}><RotateCcw className="h-3 w-3" aria-hidden="true" /> 回滚</button>}
          </li>
        })}</ul>
      </details>}
    </>}
  </section>
}
