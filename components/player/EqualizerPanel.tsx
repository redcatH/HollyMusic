import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, AudioLines, Check, ChevronDown, ChevronRight, Headphones, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { attachAnalysisPipeline, isAppleMobile, resumeAudioPipeline } from '@/lib/client/audio-analysis'
import { EQ_PRESETS } from '@/lib/client/equalizer'
import { EQ_STATUS_MESSAGES } from '@/lib/client/equalizer-status'
import { useEqualizerStore } from '@/lib/store/equalizer-store'
import { EqualizerBands } from './EqualizerBands'
import { EqualizerCurve } from './EqualizerCurve'
import { EqualizerOutputSettings } from './EqualizerOutputSettings'
import { PlayerButton } from './PlayerButton'

const PRESET_DESCRIPTIONS = ['忠于原声', '明亮悦耳', '有力而鲜明', '舒展自然', '温暖细腻', '节奏与冲击', '更深的下潜', '让人声靠前', '清透的细节']

/** 两个设置分区共享同一组音频参数；路由层负责导航，切换分区不重建播放器。 */
export function EqualizerPanel({ audio, onBack }: { audio: HTMLAudioElement | null; onBack?: () => void }) {
  const { settings, saved, sampleRate, status, update, setBand, selectPreset, reset } = useEqualizerStore()
  const id = useId()
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const [page, setPage] = useState(0)
  const [showCurve, setShowCurve] = useState(false)
  const selected = EQ_PRESETS.find(preset => preset.id === settings.preset) ?? saved.find(preset => preset.id === settings.preset)
  const selectedName = selected?.name.split(' · ')[0] ?? '自定义'
  const description = PRESET_DESCRIPTIONS[EQ_PRESETS.findIndex(preset => preset.id === settings.preset)] ?? '按你的喜好，细调每一处声音。'
  const statusMessage = settings.enabled ? EQ_STATUS_MESSAGES[status] : ''
  const ios = isAppleMobile()
  const changePage = (next: number) => { setPage(next); tabs.current[next]?.focus() }
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    changePage(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - page)
  }

  return <div className="eq-settings" onKeyDown={event => event.stopPropagation()}>
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">{onBack && <button type="button" aria-label="返回" onClick={onBack} className="eq-step-button shrink-0"><ArrowLeft className="h-4 w-4" /></button>}<div className="min-w-0"><h1 className="page-title">声音设置</h1><p className="eq-heading-desktop mt-1.5 text-sm text-muted-foreground">选择喜欢的音色，或调出自己的声音。</p><p className="eq-heading-mobile mt-1.5 text-xs text-muted-foreground">{settings.enabled ? '均衡器已开启' : '均衡器已关闭 · 原声播放'}</p></div></div>
    <label className="eq-enable flex min-h-11 cursor-pointer items-center gap-3">
      <AudioLines className={`eq-enable-icon h-5 w-5 shrink-0 ${settings.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="eq-enable-copy min-w-0 flex-1"><span className="block text-sm font-semibold">启用均衡器</span><span className="mt-1 block text-[11px] text-muted-foreground">{settings.enabled ? status === 'running' ? '音效实时生效' : '等待音频就绪' : '原声播放 · 可预先调节'}</span></span>
      <input type="checkbox" role="switch" aria-label="启用 EQ" checked={settings.enabled} onChange={event => {
        const enabled = event.currentTarget.checked
        update({ enabled })
        if (enabled && audio) void attachAnalysisPipeline(audio).then(() => resumeAudioPipeline(audio))
      }} className="appearance-switch shrink-0 cursor-pointer" />
    </label>
    </header>
    {statusMessage && <p role="alert" className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed">{statusMessage}</p>}
      <div role="tablist" aria-label="均衡器设置" className="eq-tabs mb-5 inline-flex gap-1 rounded-xl bg-muted/70 p-1">
        {['音效调节', '输出与预设'].map((label, index) => <button key={label} ref={element => { tabs.current[index] = element }} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-page-${index}`} aria-selected={page === index} tabIndex={page === index ? 0 : -1} onClick={() => setPage(index)} onKeyDown={handleTabKey}
          className={`min-h-11 rounded-lg px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${page === index ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
      </div>
    <div className="eq-surface overflow-hidden rounded-2xl border border-border/80 bg-card">
      <section role="tabpanel" id={`${id}-page-0`} aria-labelledby={`${id}-tab-0`} hidden={page !== 0}>
        <div className="eq-workspace grid">
          <aside className="eq-preset-rail border-r border-border/70 bg-muted/25 px-4 py-5">
              <h2 className="mb-3 px-3 text-xs font-medium text-muted-foreground">音效预设</h2>
              <div className="space-y-0.5">
                {EQ_PRESETS.map(preset => <button key={preset.id} type="button" aria-label={`${preset.name.split(' · ')[0]}预设`} aria-pressed={settings.preset === preset.id} onClick={() => selectPreset(preset.id)}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${settings.preset === preset.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  <svg viewBox="0 0 40 24" aria-hidden="true" className="h-6 w-8 shrink-0 opacity-80"><path d={preset.bands.map((gain, i) => `${i ? 'L' : 'M'}${2 + i * 4},${12 - gain * 1.5}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="flex-1 font-medium">{preset.name.split(' · ')[0]}</span>
                  {settings.preset === preset.id && <Check className="h-3.5 w-3.5" />}
                </button>)}
              </div>
              <button type="button" onClick={() => changePage(1)} className="mt-4 flex min-h-11 w-full items-center justify-between border-t border-border/70 px-3 pt-2 text-sm text-muted-foreground hover:text-primary">我的预设 <span className="flex items-center gap-1 text-xs">{saved.length}<ChevronRight className="h-3.5 w-3.5" /></span></button>
          </aside>
          <div className="eq-workbench flex min-w-0 flex-col p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="eq-current-label mb-1 text-[11px] font-medium tracking-wider text-muted-foreground">当前音色</p>
                <h2 className="eq-preset-title break-words text-2xl font-semibold tracking-tight">{selectedName}</h2>
                <div className="eq-preset-select relative max-w-72">
                  <select aria-label="音效预设" value={settings.preset} onChange={event => selectPreset(event.target.value)} className="w-full min-w-0 appearance-none rounded-md bg-transparent py-1 pr-7 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
                    {EQ_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name.split(' · ')[0]}</option>)}
                    <option value="custom">自定义</option>
                    {saved.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
              </div>
              <button type="button" onClick={reset} title="恢复默认" aria-label="恢复默认" className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><RotateCcw className="h-4 w-4" /><span className="eq-reset-copy">恢复默认</span></button>
            </div>
            <div className="order-2"><EqualizerBands bands={settings.bands} sampleRate={sampleRate} onChange={setBand} /></div>
            <div className="eq-curve-slot" data-expanded={showCurve}>
              <button type="button" aria-expanded={showCurve} aria-controls={`${id}-curve`} onClick={() => setShowCurve(!showCurve)} className="eq-curve-toggle flex min-h-11 w-full items-center justify-between text-xs text-muted-foreground hover:text-primary"><span className="flex items-center gap-2"><AudioLines className="h-4 w-4" />音色曲线</span><ChevronDown className={`h-4 w-4 transition-transform ${showCurve ? 'rotate-180' : ''}`} /></button>
              <div id={`${id}-curve`} className="eq-curve-content"><EqualizerCurve settings={settings} sampleRate={sampleRate} /></div>
            </div>
            {ios && <p className="order-4 mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Headphones className="mt-0.5 h-4 w-4 shrink-0" />iPhone / iPad 开启音效后，锁屏或后台播放可能暂停。详见“输出与预设”。</p>}
          </div>
        </div>
      </section>
      <section role="tabpanel" id={`${id}-page-1`} aria-labelledby={`${id}-tab-1`} hidden={page !== 1}>
        <div className="eq-workbench p-4"><EqualizerOutputSettings /></div>
      </section>
    </div>
    <p className="mt-5 text-center text-xs text-muted-foreground">调整自动保存于此浏览器 · 关闭音效保留所有参数</p>
  </div>
}

export function EqualizerButton({ onClick }: { onClick?: () => void }) {
  const enabled = useEqualizerStore(state => state.settings.enabled)
  return <PlayerButton icon={SlidersHorizontal} label="均衡器" onClick={() => onClick?.()} active={enabled} />
}
