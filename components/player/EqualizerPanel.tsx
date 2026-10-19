import { useDeferredValue, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { attachAnalysisPipeline, isAppleMobile, resumeAudioPipeline } from '@/lib/client/audio-analysis'
import { EQ_FREQUENCIES, EQ_PRESETS, designedResponse, isBandAvailable, protectionDb, responseFrequencies } from '@/lib/client/equalizer'
import { EQ_STATUS_MESSAGES } from '@/lib/client/equalizer-status'
import { useEqualizerStore } from '@/lib/store/equalizer-store'
import { Modal } from '@/components/shared/Modal'
import { PlayerButton } from './PlayerButton'

const db = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
const inputClass = 'min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'

export function EqualizerPanel({ audio, onClose }: { audio: HTMLAudioElement | null; onClose: () => void }) {
  const { settings, saved, sampleRate, status, update, setBand, selectPreset, reset, save, remove } = useEqualizerStore()
  const statusMessage = EQ_STATUS_MESSAGES[status]
  const [name, setName] = useState('')
  const [active, setActive] = useState<number | null>(null)
  const deferred = useDeferredValue(settings)
  const curve = useMemo(() => {
    const compensation = protectionDb(deferred, sampleRate)
    const response = designedResponse(deferred.bands, sampleRate, responseFrequencies(sampleRate, 180))
    return { compensation, path: response.map((v, i) => `${i ? 'L' : 'M'}${(i / (response.length - 1) * 600).toFixed(2)},${(80 - Math.max(-24, Math.min(24, deferred.enabled ? v + deferred.preamp + compensation : 0)) * 3).toFixed(2)}`).join(' ') }
  }, [deferred, sampleRate])
  const resume = () => {
    if (audio) void attachAnalysisPipeline(audio).then(() => resumeAudioPipeline(audio))
  }
  return <Modal open onClose={onClose} title="均衡器" description="雕琢声音的每一处细节 · 10 段图形 EQ" size="xl" closeButtonLabel="关闭均衡器" bodyClassName="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <div className="flex items-center justify-between gap-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" role="switch" checked={settings.enabled} onChange={e => { update({ enabled: e.target.checked }); if (e.target.checked) resume() }} className="h-5 w-5 accent-primary" />启用 EQ</label>
      <button type="button" onClick={reset} className={`${inputClass} hover:bg-accent`}>恢复默认</button>
    </div>
    <label className="mt-4 flex items-center gap-3 text-sm">音效预设
      <select aria-label="音效预设" value={settings.preset} onChange={e => selectPreset(e.target.value)} className={`${inputClass} min-w-0 flex-1`}>
        {EQ_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="custom">自定义 · Custom</option>
        {saved.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <figure className="mt-4 rounded-2xl border border-border bg-muted/25 p-3">
      <figcaption className="flex justify-between text-xs text-muted-foreground"><span>稳态输出频响 · {settings.enabled ? '已启用' : '已旁路'}</span><span>+24 / 0 / −24 dB</span></figcaption>
      <svg viewBox="0 0 600 160" role="img" aria-label="均衡器输出频率响应曲线" className="mt-2 w-full text-primary">
        {[8,80,152].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" opacity="0.15" />)}
        <path d={curve.path} stroke="currentColor" strokeWidth="2.5" fill="none" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>10 Hz</span><span>{Math.round((sampleRate * 0.499) / 1000)} kHz</span></div>
    </figure>
    <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-muted/20 p-2 pb-3" aria-label="10 段频率调节">
      <div className="grid min-w-[440px] grid-cols-10 gap-1">
        {EQ_FREQUENCIES.map((frequency, index) => <label key={frequency} className={`flex flex-col items-center gap-2 rounded-lg py-2 text-xs transition-colors ${active === index ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
          <output className="text-[10px] tabular-nums">{db(settings.bands[index])}</output>
          <input type="range" min="-12" max="12" step="0.5" value={settings.bands[index]} disabled={!isBandAvailable(index, sampleRate)} title={!isBandAvailable(index, sampleRate) ? '当前采样率无法处理此频段' : undefined} aria-label={`${frequency} Hz 增益`} aria-valuetext={db(settings.bands[index])}
            onFocus={() => setActive(index)} onBlur={() => setActive(null)} onPointerDown={() => setActive(index)} onPointerUp={() => setActive(null)} onChange={e => setBand(index, Number(e.target.value))}
            style={{ writingMode: 'vertical-lr', direction: 'rtl', touchAction: 'none' }} className="h-40 w-9 cursor-pointer accent-primary disabled:opacity-30" />
          <span>{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
        </label>)}
      </div>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">范围 −12 至 +12 dB；手机可横向滚动频段。{!settings.enabled && '当前设置已保存，开启 EQ 后生效。'}</p>
    <label className="mt-5 flex items-center justify-between text-sm" htmlFor="eq-preamp"><span>手动前级增益</span><output>{db(settings.preamp)}</output></label>
    <input id="eq-preamp" type="range" min="-12" max="12" step="0.5" value={settings.preamp} onChange={e => update({ preamp: Number(e.target.value), preset: 'custom' })} className="mt-2 h-9 w-full accent-primary" />
    <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" role="switch" checked={settings.autoPreamp} onChange={e => update({ autoPreamp: e.target.checked, preset: 'custom' })} className="h-5 w-5 accent-primary" />自动防削波<span className="ml-auto text-xs tabular-nums text-muted-foreground">保护 {db(curve.compensation)}</span></label>
    <p className="text-xs leading-relaxed text-muted-foreground">曲线包含手动前级和自动保护，以实际采样率及补偿后的滤波器级联响应计算。低采样率无法处理的频段会禁用。软件保护降低削波风险，不能保证所有音源及瞬态峰值绝对不削波；较大提升会降低整体响度。</p>
    <form className="mt-5 flex gap-2" onSubmit={e => { e.preventDefault(); save(name); setName('') }}>
      <input aria-label="自定义预设名称" placeholder="保存当前设置为…" value={name} maxLength={40} onChange={e => setName(e.target.value)} className={`${inputClass} min-w-0 flex-1`} />
      <button type="submit" disabled={!name.trim() || saved.length >= 20} className={`${inputClass} bg-primary text-primary-foreground disabled:opacity-40`}>保存</button>
    </form>
    {saved.length > 0 && <ul className="mt-2 divide-y divide-border">{saved.map(p => <li key={p.id} className="flex items-center justify-between gap-2 text-sm"><button type="button" onClick={() => selectPreset(p.id)} className="min-h-11 flex-1 truncate text-left hover:text-primary">{p.name}</button><button type="button" aria-label={`删除预设 ${p.name}`} onClick={() => remove(p.id)} className="min-h-11 px-3 text-muted-foreground hover:text-destructive">删除</button></li>)}</ul>}
    <p className="mt-3 text-xs text-muted-foreground">最多保存 20 个预设，仅保存在此浏览器；恢复默认保留已保存的自定义预设。</p>
    {isAppleMobile() && <p className="mt-3 rounded-xl bg-muted p-3 text-xs leading-relaxed">iOS / iPadOS 开启 EQ 后，系统可能在锁屏或后台暂停 Web Audio。回到应用后可通过播放按钮恢复；关闭 EQ 会旁路滤波，但当前媒体已接入 Web Audio。如需恢复原生后台播放，请关闭 EQ 后刷新页面。PWA 无法绕过系统限制。</p>}
    {statusMessage && <p role="alert" className="mt-3 rounded-xl border border-border p-3 text-sm">{statusMessage}</p>}
  </Modal>
}

export function EqualizerButton({ audio }: { audio: HTMLAudioElement | null }) {
  const [open, setOpen] = useState(false)
  const enabled = useEqualizerStore(s => s.settings.enabled)
  return <><PlayerButton icon={SlidersHorizontal} label="均衡器" onClick={() => setOpen(true)} active={enabled} />{open && <EqualizerPanel audio={audio} onClose={() => setOpen(false)} />}</>
}
