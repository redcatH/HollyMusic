import { useDeferredValue, useId, useMemo } from 'react'
import { designedResponse, protectionDb, responseFrequencies, type EqualizerSettings } from '@/lib/client/equalizer'

export function EqualizerCurve({ settings, sampleRate }: { settings: EqualizerSettings; sampleRate: number }) {
  const id = useId()
  const deferred = useDeferredValue(settings)
  const path = useMemo(() => {
    const compensation = protectionDb({ ...deferred, enabled: true }, sampleRate)
    const response = designedResponse(deferred.bands, sampleRate, responseFrequencies(sampleRate, 180))
    return response.map((value, index) => `${index ? 'L' : 'M'}${(index / (response.length - 1) * 600).toFixed(2)},${(60 - Math.max(-24, Math.min(24, value + deferred.preamp + compensation)) * 2).toFixed(2)}`).join(' ')
  }, [deferred, sampleRate])

  return <figure className="overflow-hidden pb-4">
    <figcaption className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>输出响应</span><span>{settings.enabled ? '含输出增益与自动补偿' : '开启后的效果预览'}</span></figcaption>
    <div className="relative mt-2 pr-6">
      <svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="均衡器输出频率响应曲线" className="eq-curve h-20 w-full overflow-visible text-primary">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity="0.2" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        {[12, 60, 108].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" strokeDasharray={y === 60 ? undefined : '3 6'} opacity={y === 60 ? 0.2 : 0.08} />)}
        <path d={`${path} L600,120 L0,120 Z`} fill={`url(#${id})`} />
        <path d={path} stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" />
      </svg>
      <div aria-hidden="true" className="absolute inset-y-0 right-0 flex flex-col justify-between py-1 text-[9px] tabular-nums text-muted-foreground"><span>+24</span><span>0</span><span>−24</span></div>
    </div>
    <div aria-hidden="true" className="mt-1 flex justify-between pr-6 text-[10px] text-muted-foreground"><span>10 Hz</span><span>低频</span><span>中频</span><span>高频</span><span>{Math.round(sampleRate * 0.499 / 1000)} kHz</span></div>
  </figure>
}
