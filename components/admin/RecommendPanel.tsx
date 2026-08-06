/**
 * 推荐管理面板（admin Tab 子组件）。
 * 两个子 Tab（切换不卸载组件 → 保留各 Tab 状态；手动刷新）：
 *   - 添加推荐：搜索歌曲（复用 /api/search），全选/反选/按音源，批量加入白名单
 *   - 推荐列表：搜索 + 排序 + 每页数量 + 批量取消 + 分页（商业项目标配列表管理）
 *
 * 用组件本地 state 管理搜索，不复用全局 search-store（避免与首页搜索互相干扰）。
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { search } from '@/lib/api/search'
import {
  listRecommended,
  addRecommended,
  removeRecommended,
  removeRecommendedBatch,
  type AdminRecommendSong,
} from '@/lib/api/admin-recommend'
import type { Song, SourceType } from '@/lib/types/music'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { CoverImage } from '@/components/shared/CoverImage'
import { SourceBadge } from '@/components/shared/SourceBadge'
import {
  Sparkles,
  Search,
  Loader2,
  CheckCircle2,
  X,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'

const PLATFORMS = ['kw', 'kg', 'tx', 'wy', 'mg'] as const
const ALL_SOURCES: SourceType[] = ['kw', 'kg', 'tx', 'wy', 'mg']
// 音源短标签与配色（与 SourceBadge 一致，用于按音源批量选择按钮）
const SOURCE_SHORT: Record<string, string> = {
  tx: 'QQ', wy: '网易', kw: '酷我', kg: '酷狗', mg: '咪咕',
}
const SOURCE_COLORS: Record<string, string> = {
  tx: 'bg-green-500/20 text-green-400 hover:opacity-80',
  wy: 'bg-red-500/20 text-red-400 hover:opacity-80',
  kw: 'bg-yellow-500/20 text-yellow-400 hover:opacity-80',
  kg: 'bg-blue-500/20 text-blue-400 hover:opacity-80',
  mg: 'bg-purple-500/20 text-purple-400 hover:opacity-80',
}
const PLATFORM_LABELS: Record<string, string> = {
  tx: '腾讯',
  wy: '网易',
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
}

type RecSortBy = 'updatedAt' | 'name' | 'singer'
type RecSortOrder = 'asc' | 'desc'
interface RecListOpts {
  keyword?: string
  sortBy?: RecSortBy
  sortOrder?: RecSortOrder
  limit?: number
}

export function RecommendPanel() {
  // 子 Tab：切换不重新请求、保留各 Tab 状态（hidden 切换，组件不卸载）
  const [activeTab, setActiveTab] = useState<'add' | 'list'>('add')

  // ── 添加推荐：搜索状态 ──
  const [source, setSource] = useState<SourceType | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [limit, setLimit] = useState('') // 每个音源返回数量，留空默认 30
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<Song[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set()) // 添加推荐的多选

  // ── 推荐列表状态 ──
  const [recommended, setRecommended] = useState<AdminRecommendSong[]>([])
  const [loadingRec, setLoadingRec] = useState(true)
  const [recError, setRecError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [recKeyword, setRecKeyword] = useState('')
  const [recSortBy, setRecSortBy] = useState<RecSortBy>('updatedAt')
  const [recSortOrder, setRecSortOrder] = useState<RecSortOrder>('desc')
  const [selectedRec, setSelectedRec] = useState<Set<string>>(new Set()) // 列表的多选

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // 已推荐 uid 集合，用于搜索结果标记「已推荐」
  const recommendedUids = useMemo(() => new Set(recommended.map(r => r.uid)), [recommended])

  // 当前列表查询参数（搜索/排序/分页/刷新统一复用，保证翻页不丢筛选条件）
  const currentListOpts = useCallback(
    (): RecListOpts => ({
      keyword: recKeyword.trim() || undefined,
      sortBy: recSortBy,
      sortOrder: recSortOrder,
      limit: pageSize,
    }),
    [recKeyword, recSortBy, recSortOrder, pageSize],
  )

  const reloadRecommended = useCallback(async (requestedPage: number, opts?: RecListOpts) => {
    const requestLimit = Math.max(1, Math.min(opts?.limit ?? 50, 200))
    setLoadingRec(true)
    setRecError(null)
    try {
      let pageToLoad = requestedPage
      let res = await listRecommended(pageToLoad, requestLimit, opts)
      // 边界：请求的页超出范围（如取消推荐后当前页变空），回退到第一页
      if (res.list.length === 0 && pageToLoad > 1 && res.total > 0) {
        pageToLoad = 1
        res = await listRecommended(pageToLoad, requestLimit, opts)
      }
      setRecommended(res.list)
      setTotal(res.total)
      setPage(pageToLoad)
    } catch (e) {
      setRecError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoadingRec(false)
    }
  }, [])

  // 初始加载推荐列表（仅一次；Tab 切换不重复请求，靠手动刷新）
  useEffect(() => {
    reloadRecommended(1)
  }, [reloadRecommended])

  // 切 Tab 时滚动到顶部
  useEffect(() => {
    const main = document.querySelector('main')
    if (main) main.scrollTo({ top: 0 })
  }, [activeTab])

  // ── 添加推荐：搜索逻辑 ──
  const parseLimit = (v: string): number => {
    const n = parseInt(v, 10)
    if (!Number.isFinite(n) || n < 1) return 30
    return Math.min(n, 100)
  }

  const runSearch = async () => {
    const kw = keyword.trim()
    if (!kw) return
    setSearching(true)
    setSearchError(null)
    setSearched(true)
    setSelected(new Set())
    try {
      const realLimit = parseLimit(limit)
      const sources: SourceType[] = source === 'all' ? ALL_SOURCES : [source]
      const responses = await Promise.all(
        sources.map(s =>
          search(s, kw, 1, realLimit)
            .then(r => r.list)
            .catch(() => [] as Song[]),
        ),
      )
      setSearchResults(responses.flat())
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : '搜索失败')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const selectableResults = useMemo(
    () => searchResults.filter(s => !recommendedUids.has(s.uid)),
    [searchResults, recommendedUids],
  )
  const allSelected =
    selectableResults.length > 0 && selectableResults.every(s => selected.has(s.uid))

  const resultSources = useMemo(() => {
    const set = new Set(searchResults.map(s => s.source))
    return ALL_SOURCES.filter(s => set.has(s))
  }, [searchResults])

  const toggleSelect = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) selectableResults.forEach(s => next.delete(s.uid))
      else selectableResults.forEach(s => next.add(s.uid))
      return next
    })
  }

  const invertSelection = () => {
    setSelected(prev => {
      const next = new Set(prev)
      selectableResults.forEach(s => {
        if (next.has(s.uid)) next.delete(s.uid)
        else next.add(s.uid)
      })
      return next
    })
  }

  // 该音源的可选歌曲是否已全部选中（toggle 判断 + 按钮高亮复用）
  const sourceFullySelected = (src: SourceType) => {
    const items = selectableResults.filter(s => s.source === src)
    return items.length > 0 && items.every(s => selected.has(s.uid))
  }

  const selectBySource = (src: SourceType) => {
    setSelected(prev => {
      const next = new Set(prev)
      const items = selectableResults.filter(s => s.source === src)
      // 已全选 → 取消该源全部；未全选 → 选中该源全部（与「全选」按钮一致的 toggle 语义）
      if (items.every(s => next.has(s.uid))) items.forEach(s => next.delete(s.uid))
      else items.forEach(s => next.add(s.uid))
      return next
    })
  }

  const batchAdd = async () => {
    const uids = Array.from(selected)
    if (uids.length === 0) return
    setBusy(true)
    setMsg(null)
    try {
      const { updated } = await addRecommended(uids)
      setMsg({ kind: 'success', text: `已加入推荐 ${updated} 首` })
      setSelected(new Set())
      await reloadRecommended(1, currentListOpts())
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : '加入推荐失败' })
    } finally {
      setBusy(false)
    }
  }

  const addOne = async (uid: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await addRecommended([uid])
      setMsg({ kind: 'success', text: '已加入推荐' })
      await reloadRecommended(1, currentListOpts())
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : '加入推荐失败' })
    } finally {
      setBusy(false)
    }
  }

  // ── 推荐列表：搜索 / 排序 / 多选 / 取消 ──
  const runRecSearch = () => {
    setSelectedRec(new Set())
    reloadRecommended(1, currentListOpts())
  }

  const clearRecSearch = () => {
    setRecKeyword('')
    setSelectedRec(new Set())
    reloadRecommended(1, { ...currentListOpts(), keyword: undefined })
  }

  const toggleSort = (field: RecSortBy) => {
    const newSortBy = field
    const newSortOrder: RecSortOrder = recSortBy === field ? (recSortOrder === 'asc' ? 'desc' : 'asc') : 'desc'
    setRecSortBy(newSortBy)
    setRecSortOrder(newSortOrder)
    setSelectedRec(new Set())
    reloadRecommended(1, { ...currentListOpts(), sortBy: newSortBy, sortOrder: newSortOrder })
  }

  const changePageSize = (newSize: number) => {
    setPageSize(newSize)
    setSelectedRec(new Set())
    reloadRecommended(1, { ...currentListOpts(), limit: newSize })
  }

  const allRecSelected = recommended.length > 0 && recommended.every(r => selectedRec.has(r.uid))
  const toggleRecSelect = (uid: string) => {
    setSelectedRec(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }
  const toggleAllRec = () => {
    setSelectedRec(prev => {
      const next = new Set(prev)
      if (allRecSelected) recommended.forEach(r => next.delete(r.uid))
      else recommended.forEach(r => next.add(r.uid))
      return next
    })
  }

  const removeOne = async (uid: string, name: string) => {
    if (!confirm(`确定取消推荐「${name}」？`)) return
    try {
      await removeRecommended(uid)
      await reloadRecommended(page, currentListOpts())
    } catch (e) {
      alert(e instanceof Error ? e.message : '取消推荐失败')
    }
  }

  const batchRemove = async () => {
    const uids = Array.from(selectedRec)
    if (uids.length === 0) return
    if (!confirm(`确定取消推荐选中的 ${uids.length} 首歌曲？`)) return
    setBusy(true)
    setMsg(null)
    try {
      const { updated } = await removeRecommendedBatch(uids)
      setMsg({ kind: 'success', text: `已取消推荐 ${updated} 首` })
      setSelectedRec(new Set())
      await reloadRecommended(page, currentListOpts())
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : '批量取消失败' })
    } finally {
      setBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // 手动刷新：行为随当前 Tab 决定
  const refreshing = activeTab === 'add' ? searching : loadingRec
  const canRefresh = activeTab === 'add' ? !!keyword.trim() : true
  const handleRefresh = () => {
    if (activeTab === 'add') {
      if (keyword.trim()) runSearch()
    } else {
      reloadRecommended(page, currentListOpts())
    }
  }

  const renderSortIcon = (field: RecSortBy) => {
    if (recSortBy !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />
    return recSortOrder === 'asc'
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Sparkles className="h-5 w-5 text-primary" />
          推荐管理
        </h2>
        <p className="text-sm text-muted-foreground">
          搜索歌曲加入推荐白名单，首页「发现音乐」只从白名单中随机推荐
        </p>
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
            msg.kind === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'
          }`}
        >
          {msg.kind === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
          <span className="flex-1 break-all">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-current/70 hover:text-current">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 子 Tab 切换栏 + 手动刷新按钮 */}
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex gap-1">
          {([
            { key: 'add' as const, label: '添加推荐' },
            { key: 'list' as const, label: `推荐列表${total > 0 ? ` (${total})` : ''}` },
          ]).map(t => {
            const active = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || !canRefresh}
          className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title={activeTab === 'add' ? '重新搜索' : '刷新列表'}
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </button>
      </div>

      {/* ── 添加推荐 Tab（hidden 切换，保留搜索词/结果/选中状态） ── */}
      <div className={activeTab === 'add' ? '' : 'hidden'}>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={source}
              onChange={e => setSource(e.target.value as SourceType | 'all')}
              className="rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
            >
              <option value="all">全部音源</option>
              {PLATFORMS.map(p => (
                <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
              ))}
            </select>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
              placeholder="搜索歌曲或歌手"
              className="min-w-[200px] flex-1 rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
            />
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="数量"
              title="每个音源返回的数量，留空默认 30（选“全部音源”时各源各返回这么多）"
              className="w-20 rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
            />
            <button
              onClick={runSearch}
              disabled={searching || !keyword.trim()}
              className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              搜索
            </button>
          </div>

          {searchError ? (
            <EmptyState icon={Search} title="搜索失败" description={searchError} />
          ) : searching ? (
            <LoadingSkeleton count={4} />
          ) : searchResults.length > 0 ? (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={toggleAll}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    全选
                  </button>
                  <button
                    onClick={invertSelection}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    反选
                  </button>
                  {resultSources.map(src => {
                    const active = sourceFullySelected(src)
                    return (
                      <button
                        key={src}
                        onClick={() => selectBySource(src)}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ring-1 transition ${
                          active
                            ? 'bg-primary text-primary-foreground ring-primary'
                            : `${SOURCE_COLORS[src] || 'bg-muted text-muted-foreground'} ring-transparent hover:opacity-80`
                        }`}
                        title={`${active ? '取消选中' : '选中'}全部 ${SOURCE_SHORT[src]}`}
                      >
                        {SOURCE_SHORT[src]}
                      </button>
                    )
                  })}
                  <span className="text-xs text-muted-foreground">已选 {selected.size} 首</span>
                </div>
                <button
                  onClick={batchAdd}
                  disabled={busy || selected.size === 0}
                  className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  加入推荐{selected.size > 0 ? ` (${selected.size})` : ''}
                </button>
              </div>
              <div className="divide-y divide-border">
                {searchResults.map(s => {
                  const isRec = recommendedUids.has(s.uid)
                  const checked = selected.has(s.uid)
                  return (
                    <div key={s.uid} className="flex items-center gap-3 py-2">
                      <button
                        onClick={() => !isRec && toggleSelect(s.uid)}
                        disabled={isRec}
                        className="shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                        title={isRec ? '已在推荐中' : '勾选'}
                      >
                        {isRec ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : checked ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <CoverImage uid={s.uid} className="h-10 w-10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs text-muted-foreground">{s.singer}</span>
                          <SourceBadge source={s.source} />
                        </div>
                      </div>
                      {isRec ? (
                        <span className="shrink-0 rounded bg-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-600">
                          已推荐
                        </span>
                      ) : (
                        <button
                          onClick={() => addOne(s.uid)}
                          disabled={busy}
                          className="flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                        >
                          <Plus className="h-3 w-3" /> 加入
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : searched ? (
            <EmptyState icon={Search} title="无搜索结果" description="换个关键词或音源试试" />
          ) : (
            <EmptyState icon={Search} title="搜索歌曲加入推荐" description="选择音源，输入关键词后搜索" />
          )}
        </div>
      </div>

      {/* ── 推荐列表 Tab（hidden 切换，保留筛选/排序/分页/多选状态） ── */}
      <div className={activeTab === 'list' ? '' : 'hidden'}>
        {/* 工具栏：筛选 + 每页数量 + 批量取消 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={recKeyword}
            onChange={e => setRecKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runRecSearch() }}
            placeholder="按歌名或歌手筛选"
            className="min-w-[180px] flex-1 rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
          <button
            onClick={runRecSearch}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" /> 筛选
          </button>
          {recKeyword && (
            <button
              onClick={clearRecSearch}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              清除
            </button>
          )}
          <div className="flex-1" />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            每页
            <select
              value={pageSize}
              onChange={e => changePageSize(Number(e.target.value))}
              className="rounded-md bg-background px-2 py-1.5 text-xs outline-none ring-1 ring-border focus:ring-primary"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
          {selectedRec.size > 0 && (
            <button
              onClick={batchRemove}
              disabled={busy}
              className="flex items-center gap-1 rounded-full bg-destructive/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              取消推荐 ({selectedRec.size})
            </button>
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <button
              onClick={() => reloadRecommended(page - 1, currentListOpts())}
              disabled={page <= 1 || loadingRec}
              className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
            <button
              onClick={() => reloadRecommended(page + 1, currentListOpts())}
              disabled={page >= totalPages || loadingRec}
              className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {loadingRec ? (
          <LoadingSkeleton count={5} />
        ) : recError ? (
          <EmptyState icon={Sparkles} title="加载失败" description={recError} />
        ) : recommended.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={recKeyword ? '没有匹配的推荐歌曲' : '暂无推荐歌曲'}
            description={recKeyword ? '换个关键词试试' : '切到「添加推荐」搜索并加入'}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-accent/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allRecSelected}
                      onChange={toggleAllRec}
                      className="h-4 w-4 rounded accent-primary"
                      title="全选当前页"
                    />
                  </th>
                  <th
                    onClick={() => toggleSort('name')}
                    className="cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground"
                  >
                    歌曲{renderSortIcon('name')}
                  </th>
                  <th
                    onClick={() => toggleSort('singer')}
                    className="cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground"
                  >
                    歌手{renderSortIcon('singer')}
                  </th>
                  <th className="px-4 py-3 font-medium">音源</th>
                  <th
                    onClick={() => toggleSort('updatedAt')}
                    className="cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground"
                  >
                    更新时间{renderSortIcon('updatedAt')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {recommended.map(r => (
                  <tr key={r.uid} className="border-t border-border hover:bg-accent/20">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedRec.has(r.uid)}
                        onChange={() => toggleRecSelect(r.uid)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <CoverImage uid={r.uid} className="h-8 w-8 shrink-0" />
                        <span className="font-medium">{r.name || '未知'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.singer || '-'}</td>
                    <td className="px-4 py-3"><SourceBadge source={r.source} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(r.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => removeOne(r.uid, r.name || '未知')}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                          title="取消推荐"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
