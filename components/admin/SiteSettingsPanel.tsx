import { useEffect, useState, type FormEvent } from 'react'
import { Music2, Loader2 } from 'lucide-react'
import { fetchAdminSiteSettings, saveSiteSettings } from '@/lib/api/site-settings'
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, SITE_NAME_MAX_LENGTH, SITE_DESCRIPTION_MAX_LENGTH, type SiteSettings } from '@/lib/site-settings'
import { useSiteSettingsStore } from '@/lib/store/site-settings-store'
import { ProjectAttribution } from '@/components/shared/ProjectAttribution'

export function SiteSettingsPanel() {
  const [draft, setDraft] = useState<SiteSettings | null>(null)
  const [saved, setSaved] = useState<SiteSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const apply = useSiteSettingsStore(s => s.apply)

  useEffect(() => {
    let active = true
    fetchAdminSiteSettings().then(settings => {
      if (active) { setDraft(settings); setSaved(settings); apply(settings) }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '加载失败')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt, apply])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft || saving) return
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const settings = await saveSiteSettings(parseSiteSettings(draft))
      apply(settings)
      setSaved(settings)
      setDraft(settings)
      setMessage('站点设置已保存。其他用户刷新页面后生效。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    } finally { setSaving(false) }
  }

  if (loading) return <p role="status" className="text-sm text-muted-foreground">正在加载站点设置…</p>
  if (!draft) return <div role="alert" className="text-sm"><p>{error}</p><button onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1) }} className="mt-3 text-primary">重新加载</button></div>
  const dirty = draft.name !== saved?.name || draft.description !== saved?.description
  return <form onSubmit={submit} className="max-w-2xl space-y-6">
    <div><h2 className="text-lg font-semibold">站点设置</h2><p className="mt-1 text-sm text-muted-foreground">为所有用户设置站点名称与简介。默认使用 Holly Music。</p></div>
    <fieldset disabled={saving} className="space-y-5 disabled:opacity-70">
      <div>
        <label htmlFor="site-name" className="mb-2 block text-sm font-medium">站点名称</label>
        <input id="site-name" required maxLength={SITE_NAME_MAX_LENGTH} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setMessage('') }} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
        <p className="mt-2 text-xs text-muted-foreground">显示在导航、登录页面、浏览器标题和安装的应用名称中，最多 {SITE_NAME_MAX_LENGTH} 个字符。</p>
      </div>
      <div>
        <label htmlFor="site-description" className="mb-2 block text-sm font-medium">站点简介</label>
        <input id="site-description" maxLength={SITE_DESCRIPTION_MAX_LENGTH} value={draft.description} onChange={event => { setDraft({ ...draft, description: event.target.value }); setMessage('') }} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
        <p className="mt-2 text-xs text-muted-foreground">可留空，最多 {SITE_DESCRIPTION_MAX_LENGTH} 个字符。</p>
      </div>
    </fieldset>
    <section aria-label="站点预览" className="rounded-2xl border border-border bg-card p-5">
      <p className="mb-4 text-xs text-muted-foreground">预览</p>
      <div className="flex min-w-0 items-center gap-3"><Music2 className="h-6 w-6 shrink-0 text-primary" /><span className="truncate font-semibold" title={draft.name}>{draft.name.trim() || DEFAULT_SITE_SETTINGS.name}</span></div>
      {draft.description.trim() && <p className="mt-3 break-words text-sm text-muted-foreground">{draft.description.trim()}</p>}
      <div className="mt-5"><ProjectAttribution /></div>
    </section>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm text-primary">{message}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={saving || !dirty} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}保存设置</button>
      <button type="button" disabled={saving} onClick={() => { setDraft({ ...DEFAULT_SITE_SETTINGS }); setError(''); setMessage('已恢复默认值，保存后生效。') }} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">恢复默认值</button>
    </div>
  </form>
}
