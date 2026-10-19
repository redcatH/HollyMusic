import { useId, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { EQ_FREQUENCIES, isBandAvailable } from '@/lib/client/equalizer'

const BAND_HINTS = ['低音的深度', '低音的力度', '声音的温暖', '声音的厚度', '中频的饱满', '人声的清晰', '声音的存在感', '细节的明亮', '高频的通透', '空气感与延伸']
export const formatGain = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)}`
export const formatFrequency = (frequency: number): string => frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`

export function EqualizerBands({ bands, sampleRate, onChange }: {
  bands: number[]
  sampleRate: number
  onChange: (index: number, gain: number) => void
}) {
  const id = useId()
  const [group, setGroup] = useState(0)
  const [active, setActive] = useState(0)
  const available = isBandAvailable(active, sampleRate)
  const selectGroup = (next: number) => {
    setGroup(next)
    if (Math.floor(active / 5) !== next) setActive(next * 5)
  }

  return <div>
    <div className="eq-band-groups mb-4 grid grid-cols-2 gap-2" aria-label="频段范围">
      {[['低频', '31–500 Hz'], ['高频', '1–16 kHz']].map(([label, range], index) => <button key={label} type="button" aria-label={`${label} · ${range}`} aria-pressed={group === index} onClick={() => selectGroup(index)}
        className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${group === index ? 'border-primary/25 bg-primary/8 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground'}`}><span className="text-sm">{label}</span><span className="whitespace-nowrap text-[10px] font-normal opacity-80">{range}</span></button>)}
    </div>
    <div className="relative pl-7" aria-label="10 段频率调节">
      <div aria-hidden="true" className="eq-band-axis pointer-events-none absolute inset-x-0 top-12 h-44 text-[10px] tabular-nums text-muted-foreground">
        {[['+12', 'top-0'], ['0', 'top-1/2'], ['−12', 'top-full']].map(([label, position]) => <div key={label} className={`absolute inset-x-0 flex -translate-y-1/2 items-center gap-2 ${position}`}><span className="w-5 shrink-0 text-right">{label}</span><span className={`flex-1 border-t ${label === '0' ? 'border-border' : 'border-dashed border-border/50'}`} /></div>)}
      </div>
      <div className="eq-band-grid relative grid grid-cols-5 gap-1" aria-label="频段增益，单位 dB">
        {EQ_FREQUENCIES.map((frequency, index) => {
          const available = isBandAvailable(index, sampleRate)
          return <div key={frequency} data-band-group={Math.floor(index / 5) === group ? 'visible' : 'hidden'} className={`eq-band min-w-0 flex-col items-center rounded-xl ${active === index ? 'bg-primary/5' : ''}`}>
            <button type="button" disabled={!available} onClick={() => { setActive(index); onChange(index, 0) }} aria-label={`重置 ${frequency} Hz 增益`} title="点击数值归零"
              className={`eq-band-value mb-1 flex h-11 w-full items-center justify-center rounded-lg text-xs font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 ${active === index ? 'text-primary' : 'text-foreground'}`}>{available ? formatGain(bands[index]) : '—'}</button>
            <input id={`${id}-${index}`} type="range" min="-12" max="12" step="0.5" value={bands[index]} disabled={!available}
              aria-label={`${frequency} Hz 增益`} aria-valuetext={`${formatGain(bands[index])} dB`} aria-describedby={!available ? `${id}-unavailable` : undefined}
              onFocus={() => setActive(index)} onPointerDown={() => setActive(index)} onChange={event => { setActive(index); onChange(index, Number(event.target.value)) }} className="eq-fader" />
            <label htmlFor={`${id}-${index}`} className="flex min-h-11 cursor-pointer items-center justify-center whitespace-nowrap text-[10px] font-medium text-muted-foreground sm:text-xs">{formatFrequency(frequency)}</label>
          </div>
        })}
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
      <div className="min-w-0"><p className="text-sm font-semibold">{formatFrequency(EQ_FREQUENCIES[active])}<span className="ml-2 text-xs font-normal text-muted-foreground">{BAND_HINTS[active]}</span></p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{available ? '每步 0.5 dB · 点击数值归零' : '当前采样率不支持此频段'}</p></div>
      <div className="flex shrink-0 gap-1">
        <button type="button" aria-label={`降低 ${EQ_FREQUENCIES[active]} Hz 增益`} disabled={!available || bands[active] <= -12} onClick={() => onChange(active, bands[active] - 0.5)} className="eq-step-button"><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label={`提高 ${EQ_FREQUENCIES[active]} Hz 增益`} disabled={!available || bands[active] >= 12} onClick={() => onChange(active, bands[active] + 0.5)} className="eq-step-button"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
    {EQ_FREQUENCIES.some((_, index) => !isBandAvailable(index, sampleRate)) && <p id={`${id}-unavailable`} className="mt-2 text-xs text-muted-foreground">当前音频采样率下，部分高频频段不可用。</p>}
  </div>
}
