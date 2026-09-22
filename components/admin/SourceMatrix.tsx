
/**
 * 音源 × 平台 管理矩阵。
 *
 * 行 = 音源（按优先级升序，行序即取链优先级；禁用源半透明置底），
 * 列 = 五大平台。单元格即点即存（乐观更新，失败回滚重拉）。
 * 行头整体启停、行尾上下移调整优先级（重排启用区为 1..n 一次提交）、
 * 列头对全部启用源一键全开/全关（需确认）。
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, Loader2 } from 'lucide-react'
import { bulkUpdateSources, type AdminSource } from '@/lib/api/admin-sources'
import { toast } from '@/lib/toast'

const PLATFORMS = ['wy', 'tx', 'kg', 'kw', 'mg'] as const
const PLATFORM_LABELS: Record<string, string> = {
  wy: '网易',
  tx: '腾讯',
  kg: '酷狗',
  kw: '酷我',
  mg: '咪咕',
}

/** pt 未配置时允许所有平台；实际可用的平台仍由脚本声明决定。 */
function effectivePt(s: AdminSource): string[] {
  return s.pt && s.pt.length > 0 ? s.pt : [...PLATFORMS]
}

/** 可见行序：启用源按 priority 升序在前，禁用源置底。 */
function sortRows(sources: AdminSource[]): AdminSource[] {
  return [...sources].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    return a.priority - b.priority
  })
}

export function SourceMatrix({
  sources,
  reload,
  onBusyChange,
}: {
  sources: AdminSource[]
  reload: () => Promise<void>
  onBusyChange?: (busy: boolean) => void
}) {
  // 本地乐观态：与 props 同步（父组件静默重拉后合并），点击时先行变更
  const [rows, setRows] = useState<AdminSource[]>(() => sortRows(sources))
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    setRows(sortRows(sources))
  }, [sources])

  const enabledRows = rows.filter(r => r.enabled)

  const saveUpdates = async (
    key: string,
    updates: Parameters<typeof bulkUpdateSources>[0],
    successMessage?: (updated: number) => string,
  ) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(key)
    onBusyChange?.(true)
    const previousRows = rows
    const byPath = new Map(updates.map(update => [update.path, update]))
    setRows(previous => sortRows(previous.map(row => ({ ...row, ...byPath.get(row.path) }))))
    try {
      const { updated } = await bulkUpdateSources(updates)
      if (successMessage) toast.success(successMessage(updated))
    } catch (error) {
      // 即使重拉也失败，仍能恢复操作前状态。
      setRows(previousRows)
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      try {
        await reload()
      } catch {
        toast.error('刷新音源列表失败，请重试')
      } finally {
        busyRef.current = false
        setBusy(null)
        onBusyChange?.(false)
      }
    }
  }

  /** 单元格切换：pt 固化为「当前生效集合 ± 平台」后即时保存。 */
  const toggleCell = async (s: AdminSource, platform: string) => {
    const current = effectivePt(s)
    const nextPt = current.includes(platform)
      ? current.filter(p => p !== platform)
      : [...current, platform]
    if (nextPt.length === 0) {
      toast.warning('至少保留一个平台；如需整体停用请使用启停开关')
      return
    }
    await saveUpdates(`${s.path}#${platform}`, [{ path: s.path, pt: nextPt }])
  }

  /** 行首整体启停。 */
  const toggleRow = async (s: AdminSource) => {
    await saveUpdates(s.path, [{ path: s.path, enabled: !s.enabled }])
  }

  /**
   * 上移/下移：将启用区按当前行序重排为 priority 1..n（目标行交换后），
   * 一次性批量提交；禁用源不参与（不改变其 priority）。
   */
  const moveRow = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (index < 0 || target < 0 || target >= enabledRows.length) return
    const reordered = [...enabledRows]
    const moved = reordered.splice(index, 1)[0]
    reordered.splice(target, 0, moved)

    const updates = reordered.map((r, i) => ({ path: r.path, priority: i + 1 }))
    await saveUpdates(moved.path, updates)
  }

  /** 列级批量：混合态 → 全开；全开 → 全关。影响所有启用源，需确认。 */
  const toggleColumn = async (platform: string) => {
    if (busyRef.current || enabledRows.length === 0) return
    const allOn = enabledRows.length > 0 && enabledRows.every(r => effectivePt(r).includes(platform))
    const verb = allOn ? '关闭' : '开启'
    const blocked = allOn ? enabledRows.filter(r => effectivePt(r).length === 1) : []
    if (blocked.length > 0) {
      toast.warning(`无法全部关闭：${blocked.map(r => r.name || r.path).join('、')} 仅选择了该平台，请先使用启停开关停用这些音源`)
      return
    }
    if (!confirm(`确定对全部 ${enabledRows.length} 个启用音源${verb}「${PLATFORM_LABELS[platform]}」？实际支持以脚本为准。`)) return
    const updates = enabledRows.map(r => {
      const current = effectivePt(r)
      return { path: r.path, pt: allOn ? current.filter(p => p !== platform) : [...new Set([...current, platform])] }
    })
    await saveUpdates(`col#${platform}`, updates, updated => `已${verb} ${updated} 个音源的「${PLATFORM_LABELS[platform]}」`)
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无音源</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-accent/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">音源（行序 = 取链优先级）</th>
            {PLATFORMS.map(p => (
              <th key={p} className="px-2 py-3 text-center font-medium">
                <button
                  onClick={() => toggleColumn(p)}
                  disabled={busy !== null || enabledRows.length === 0}
                  className="rounded px-2 py-1 transition hover:bg-accent hover:text-foreground disabled:opacity-40"
                  title="点击对全部启用音源一键全开/全关"
                >
                  {PLATFORM_LABELS[p]}
                </button>
              </th>
            ))}
            <th className="px-3 py-3 text-center font-medium">启停</th>
            <th className="px-3 py-3 text-center font-medium">排序</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const enabledIndex = enabledRows.findIndex(r => r.path === s.path)
            const current = effectivePt(s)
            return (
              <tr
                key={s.path}
                className={`border-t border-border hover:bg-accent/20 ${s.enabled ? '' : 'opacity-45'}`}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {s.enabled && <span className="text-[10px] text-muted-foreground">{enabledIndex + 1}.</span>}
                    <span className="font-medium">{s.name || s.path}</span>
                    {s.subscription && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600">订阅</span>
                    )}
                    {!s.pt?.length && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="未限制平台，实际支持以脚本声明为准；点击后仅允许所选平台">跟随脚本</span>
                    )}
                  </div>
                </td>
                {PLATFORMS.map(p => {
                  const on = current.includes(p)
                  const key = `${s.path}#${p}`
                  return (
                    <td key={p} className="px-2 py-2.5 text-center">
                      <button
                        onClick={() => toggleCell(s, p)}
                        disabled={busy !== null}
                        aria-label={`${s.name || s.path} ${PLATFORM_LABELS[p]} ${on ? '允许' : '屏蔽'}`}
                        aria-pressed={on}
                        className={`h-6 w-6 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-muted text-transparent hover:border-primary/50'
                        }`}
                        title={on ? `允许${PLATFORM_LABELS[p]}（实际支持以脚本为准，点击屏蔽）` : `屏蔽${PLATFORM_LABELS[p]}（点击允许）`}
                      >
                        {busy === key ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin text-current" /> : '●'}
                      </button>
                    </td>
                  )
                })}
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleRow(s)}
                    disabled={busy !== null}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                      s.enabled ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {busy === s.path ? '…' : s.enabled ? '启用' : '停用'}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-center gap-0.5">
                    <button
                      onClick={() => moveRow(enabledIndex, -1)}
                      disabled={busy !== null || !s.enabled || enabledIndex <= 0}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      title="提高优先级（取链时更先尝试）"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => moveRow(enabledIndex, 1)}
                      disabled={busy !== null || !s.enabled || enabledIndex >= enabledRows.length - 1}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      title="降低优先级"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-border bg-accent/20 px-4 py-2 text-xs text-muted-foreground">
        行序 = 取链优先级（从上到下依次尝试，可用 ▲▼ 调整）；● 表示允许该平台，实际支持以脚本为准。点击列名可批量开启或关闭；只剩一个平台的音源需先整体停用。
      </p>
    </div>
  )
}
