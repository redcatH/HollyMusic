import { useId, useState } from 'react'
import { Check, Save, ShieldCheck, SlidersHorizontal, Trash2, Volume2 } from 'lucide-react'
import { isAppleMobile } from '@/lib/client/audio-analysis'
import { protectionDb } from '@/lib/client/equalizer'
import { useEqualizerStore } from '@/lib/store/equalizer-store'
import { formatGain } from './EqualizerBands'

export function EqualizerOutputSettings() {
  const { settings, saved, sampleRate, update, selectPreset, save, remove } = useEqualizerStore()
  const id = useId()
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const compensation = protectionDb({ ...settings, enabled: true }, sampleRate)
  const ios = isAppleMobile()

  return <>
    <div className="eq-output-grid grid gap-6">
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Volume2 className="h-5 w-5 text-primary" />输出增益</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">调整整体音量，保留频段之间的比例。</p>
        <div className="mb-2 mt-6 flex items-end justify-between"><label htmlFor={`${id}-preamp`} className="text-xs text-muted-foreground">手动前级增益</label><output htmlFor={`${id}-preamp`} className="text-3xl font-semibold tracking-tight tabular-nums">{formatGain(settings.preamp)} <span className="text-xs font-normal text-muted-foreground">dB</span></output></div>
        <input id={`${id}-preamp`} type="range" aria-label="手动前级增益" aria-valuetext={`${formatGain(settings.preamp)} dB`} min="-12" max="12" step="0.5" value={settings.preamp} onChange={event => update({ preamp: Number(event.target.value), preset: 'custom' })} className="eq-horizontal-slider" />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>−12 dB</span><button type="button" onClick={() => update({ preamp: 0, preset: 'custom' })} className="min-h-11 min-w-11 hover:text-primary" aria-label="重置前级增益">归零</button><span>+12 dB</span></div>
      </div>
      <div className="eq-protection border-t border-border/70 pt-5">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3"><span className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-5 w-5 text-primary" />自动防削波</span><input type="checkbox" role="switch" aria-label="自动防削波" checked={settings.autoPreamp} onChange={event => update({ autoPreamp: event.currentTarget.checked, preset: 'custom' })} className="appearance-switch shrink-0 cursor-pointer" /></label>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">提升频段时自动降低输出，减少失真。建议保持开启。</p>
        <div className="mt-5 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-3"><span className="text-xs text-muted-foreground">{settings.enabled ? '自动补偿' : '预计补偿'}</span><span className="text-sm font-semibold tabular-nums">{settings.autoPreamp ? `${formatGain(compensation)} dB` : '已关闭'}</span></div>
      </div>
    </div>
    <section className="mt-6 border-t border-border pt-6" aria-labelledby={`${id}-saved-title`}>
      <div className="flex items-center justify-between"><h2 id={`${id}-saved-title`} className="text-lg font-semibold">我的预设</h2><span className="text-xs tabular-nums text-muted-foreground">{saved.length} / 20</span></div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">保存当前频段、输出增益和防削波设置，方便下次使用。</p>
      <form className="mt-4 flex gap-2" onSubmit={event => {
        event.preventDefault()
        if (!name.trim() || saved.length >= 20) return
        save(name)
        setMessage(`已保存“${name.trim()}”`)
        setName('')
      }}>
        <input aria-label="自定义预设名称" placeholder="给这套音效起个名字" value={name} maxLength={40} onChange={event => { setName(event.target.value); setMessage('') }} className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
        <button type="submit" disabled={!name.trim() || saved.length >= 20} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"><Save className="h-4 w-4" /><span>保存</span></button>
      </form>
      <p role="status" className="mt-2 min-h-4 text-xs text-primary">{message || (saved.length >= 20 ? '预设已满，删除一项后可继续保存。' : '')}</p>
      {saved.length > 0 ? <ul className="eq-output-grid mt-1 grid gap-2">{saved.map(preset => <li key={preset.id} className={`flex min-w-0 items-center rounded-xl border ${settings.preset === preset.id ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
        <button type="button" aria-pressed={settings.preset === preset.id} onClick={() => { selectPreset(preset.id); setMessage(`已应用“${preset.name}”`) }} className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left text-sm"><SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{preset.name}</span>{settings.preset === preset.id && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}</button>
        <button type="button" aria-label={`删除预设 ${preset.name}`} onClick={() => { remove(preset.id); setMessage(`已删除“${preset.name}”`) }} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
      </li>)}</ul> : <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">还没有保存的预设。调好喜欢的声音，就把它留在这里。</div>}
    </section>
    <details className="mt-6 rounded-xl bg-muted/30 px-4 py-1 text-xs text-muted-foreground"><summary className="cursor-pointer py-3 font-medium">使用提示{ios ? '与 iOS 后台播放' : ''}</summary><div className="space-y-2 pb-3 leading-relaxed"><p>调整会自动保存在当前浏览器。关闭均衡器保留所有参数；恢复默认不会删除已保存的预设。</p><p>自动防削波会降低整体响度，无法保证所有音源和瞬态峰值都不失真。听到破音时，可进一步降低输出增益。</p>{ios && <p>iOS / iPadOS 可能在锁屏或后台暂停音效，回到应用后可点击播放恢复。关闭 EQ 会停止音效处理；如需恢复原生后台播放，请关闭 EQ 后刷新页面。</p>}</div></details>
  </>
}
