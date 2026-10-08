import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Check, Monitor, Moon, Palette, Play, Sparkles, Sun, X } from 'lucide-react'
import { useAppearanceStore, type ThemeMode, type ThemePalette } from '@/lib/store/appearance-store'

const MODES: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor },
]

const PALETTES: Array<{ id: ThemePalette; label: string; description: string; hue: number }> = [
  { id: 'forest', label: '森林绿', description: '自然、安静', hue: 155 },
  { id: 'blue', label: '雾蓝', description: '清透、舒缓', hue: 245 },
  { id: 'apricot', label: '暖杏', description: '温暖、柔和', hue: 65 },
]

function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const mode = useAppearanceStore(s => s.mode)
  const palette = useAppearanceStore(s => s.palette)
  const coverAtmosphere = useAppearanceStore(s => s.coverAtmosphere)
  const systemDark = useAppearanceStore(s => s.systemDark)
  const update = useAppearanceStore(s => s.update)
  const dark = mode === 'dark' || (mode === 'system' && systemDark)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={() => { if (!dialogRef.current?.open) onClose() }}
      onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close() }}
      onKeyDown={event => event.stopPropagation()}
      className="appearance-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl"
    >
      <div className="p-5 sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-widest text-primary"><Palette className="h-4 w-4" /> 属于你的音乐空间</div>
            <h2 id={titleId} className="text-2xl font-semibold">外观</h2>
            <p className="mt-1 text-sm text-muted-foreground">换一种心情，音乐照常继续。</p>
          </div>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭外观设置" className="touch-target flex shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <fieldset className="mb-6">
          <legend className="mb-3 text-sm font-medium">明暗模式</legend>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/60 p-1.5">
            {MODES.map(({ id, label, icon: Icon }) => (
              <label key={id} className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl px-1 py-3 text-xs transition-colors sm:flex-row sm:justify-center sm:text-sm ${mode === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <input type="radio" name={`${titleId}-mode`} value={id} checked={mode === id} onChange={() => update({ mode: id })} className="peer sr-only" />
                <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
                <Icon className="h-4 w-4" />{label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-6">
          <legend className="mb-3 text-sm font-medium">配色风格</legend>
          <div className="grid grid-cols-3 gap-3">
            {PALETTES.map(({ id, label, description, hue }) => (
              <label key={id} style={{ '--preview-hue': hue } as CSSProperties} className={`theme-option relative min-w-0 cursor-pointer rounded-2xl border p-2 transition-colors ${palette === id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50'}`}>
                <input type="radio" name={`${titleId}-palette`} value={id} checked={palette === id} onChange={() => update({ palette: id })} className="peer sr-only" />
                <span className="pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
                <div className="theme-preview" data-preview-dark={dark} aria-hidden="true"><div className="theme-preview-sidebar"><span /><span /><span /></div><div className="theme-preview-main"><div className="theme-preview-cover" /><div className="theme-preview-line" /><div className="theme-preview-line short" /></div><div className="theme-preview-player"><span /><Play className="h-2.5 w-2.5 fill-current" /></div></div>
                <div className="mt-2 flex items-center justify-between gap-1 px-0.5 text-xs font-medium sm:text-sm">{label}{palette === id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}</div>
                <p className="mt-0.5 hidden px-0.5 text-[11px] text-muted-foreground min-[360px]:block sm:text-xs">{description}</p>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border bg-muted/25 p-4">
          <span><span className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" />封面氛围</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">在歌词页，让封面的色彩融入背景</span></span>
          <input type="checkbox" role="switch" aria-label="封面氛围" checked={coverAtmosphere} onChange={event => update({ coverAtmosphere: event.target.checked })} className="appearance-switch shrink-0 cursor-pointer" />
        </label>
        <p className="mt-5 text-center text-xs text-muted-foreground">自动保存于此浏览器 · 随时可以更换</p>
      </div>
    </dialog>
  )
}

export function AppearanceButton({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="外观设置" aria-haspopup="dialog" className={`flex min-h-11 items-center gap-3 rounded-xl text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${compact ? 'w-11 justify-center' : 'w-full px-3 py-2'} ${className}`}>
        <Palette className="h-5 w-5 shrink-0" />{!compact && <span>外观</span>}
      </button>
      {open && <AppearanceDialog onClose={() => setOpen(false)} />}
    </>
  )
}
