
/**
 * 音源 × 平台 管理矩阵。
 *
 * 行 = 音源（按优先级升序，行序即取链优先级；禁用源半透明置底），
 * 列 = 五大平台。单元格即点即存（乐观更新，失败回滚重拉）。
 * 行头整体启停、行尾上下移调整优先级（重排启用区为 1..n 一次提交）、
 * 列头对全部启用源一键全开/全关（需确认）。
 */

import { useEffect, useState } from 'react'
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

/** pt 未配置（跟随脚本声明）时按全平台显示，首次点击后固化为显式数组。 */
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
}: {
  sources: AdminSource[]
  reload: () => Promise<void>
}) {
  // 本地乐观态：与 props 同步（父组件静默重拉后合并），点击时先行变更
  const [rows, setRows] = useState<AdminSource[]>(() => sortRows(sources))
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setRows(sortRows(sources))
  }, [sources])

  const enabledRows = rows.filter(r => r.enabled)

  /** 单元格切换：pt 固化为「当前生效集合 ± 平台」后即时保存。 */
  const toggleCell = async (s: AdminSource, platform: string) => {
    const current = effectivePt(s)
    const nextPt = current.includes(platform)
      ? current.filter(p => p !== platform)
      : [...current, platform]
    if (nextPt.length === 0) {
      toast.warning('至少保留一个平台；如需整体停用请使用行首开关')
      return
    }
    const key = `${s.path}#${platform}`
    setBusy(key)
    setRows(prev => prev.map(r => (r.path === s.path ? { ...r, pt: nextPt } : r)))
    try {
      await bulkUpdateSources([{ path: s.path, pt: nextPt }])
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
      await reload()
    } finally {
      setBusy(null)
    }
  }

  /** 行首整体启停。 */
  const toggleRow = async (s: AdminSource) => {
    setBusy(s.path)
    setRows(prev => prev.map(r => (r.path === s.path ? { ...r, enabled: !r.enabled } : r)))
    try {
      await bulkUpdateSources([{ path: s.path, enabled: !s.enabled }])
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
      await reload()
    } finally {
      setBusy(null)
    }
  }

  /**
   * 上移/下移：将启用区按当前行序重排为 priority 1..n（目标行交换后），
   * 一次性批量提交；禁用源不参与（不改变其 priority）。
   */
  const moveRow = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    const enabledIdx = enabledRows.map(r => rows.indexOf(r))
    if (target < 0 || target >= enabledIdx.length) return
    const reordered = [...enabledRows]
    const moved = reordered.splice(index, 1)[0]
    reordered.splice(target, 0, moved)

    const updates = reordered.map((r, i) => ({ path: r.path, priority: i + 1 }))
    setBusy(rows[index].path)
    setRows(prev => sortRows(prev.map(r => {
      const hit = updates.find(u => u.path === r.path)
      return hit ? { ...r, priority: hit.priority } : r
    })))
    try {
      await bulkUpdateSources(updates)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '调整优先级失败')
      await reload()
    } finally {
      setBusy(null)
    }
  }

  /** 列级批量：混合态 → 全开；全开 → 全关。影响所有启用源，需确认。 */
  const toggleColumn = async (platform: string) => {
    const allOn = enabledRows.length > 0 && enabledRows.every(r => effectivePt(r).includes(platform))
    const verb = allOn ? '关闭' : '开启'
    if (!confirm(`确定对全部 ${enabledRows.length} 个启用音源${verb}「${PLATFORM_LABELS[platform]}」平台支持？`)) return
    setBusy(`col#${platform}`)
    try {
      const updates = enabledRows.map(r => {
        const current = effectivePt(r)
        const nextPt = allOn ? current.filter(p => p !== platform) : [...new Set([...current, platform])]
        return nextPt.length === 0 ? null : { path: r.path, pt: nextPt }
      }).filter((u): u is { path: string; pt: string[] } => u !== null)
      if (updates.length === 0) {
        toast.warning('全部源关闭后将为空，已跳过')
        return
      }
      await bulkUpdateSources(updates)
      toast.success(`已${verb} ${updates.length} 个音源的「${PLATFORM_LABELS[platform]}」支持`)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败')
      await reload()
    } finally {
      setBusy(null)
    }
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
                    {s.pt && s.pt.length === 0 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="未配置平台限制，点击单元格后将固化为你所见的选择">跟随脚本</span>
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
                        aria-label={`${s.name || s.path} ${PLATFORM_LABELS[p]} ${on ? '已接管' : '未接管'}`}
                        className={`h-6 w-6 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-muted text-transparent hover:border-primary/50'
                        }`}
                        title={on ? `已接管${PLATFORM_LABELS[p]}（点击关闭）` : `不管${PLATFORM_LABELS[p]}（点击接管）`}
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
        行序 = 取链优先级（从上到下依次尝试，可用 ▲▼ 调整）；● 表示该音源接管对应平台的播放取链；点击列名可对该平台一键全开/全关。
      </p>
    </div>
  )
}
