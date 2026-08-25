import { useEffect, useRef, useState } from 'react'
import {
  attachAnalysisPipeline,
  getExistingAnalysisPipeline,
  type AudioAnalysisPipeline,
} from '@/lib/client/audio-analysis'
import { spectrumSynth, SPECTRUM_SYNTH_BINS } from '@/lib/client/spectrum-synth'

interface AudioSpectrumProps {
  audio: HTMLAudioElement | null
  isPlaying: boolean
  className?: string
}

/**
 * 底栏频谱：参考 lxserver 的「全宽细密分块柱状」布局。
 * 播放、暂停之间保留短暂的视觉过渡；画布隐藏后停止绘制，避免后台耗电。
 *
 * 管线所有权在 lib/client/audio-analysis.ts：只允许在手势内把元素接入已确认
 * running 的音频图。拿不到 analyser 时（iOS 禁止接管、其他内核接管失败或
 * 尚未完成）降级为 spectrum-synth 合成动画——纯视觉，不触碰音频链路。
 */
export function AudioSpectrum({ audio, isPlaying, className = '' }: AudioSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  /** 频谱视觉增益独立于音频状态，暂停时可完成淡出而不是立即清空。 */
  const visualLevelRef = useRef(0)
  const [playbackRevision, setPlaybackRevision] = useState(0)

  useEffect(() => {
    if (!audio) return

    const bind = (pipeline: AudioAnalysisPipeline | null): boolean => {
      if (!pipeline) return false
      analyserRef.current = pipeline.analyser
      setPlaybackRevision(revision => revision + 1)
      return true
    }

    // 手势路径：管线创建的唯一入口（模块内部保证仅在 context running 后接管）。
    const onGesture = () => {
      void attachAnalysisPipeline(audio).then(pipeline => {
        if (!pipeline) return
        bind(pipeline)
        // 图被系统挂起（罕见）：手势内尝试恢复，失败则保持空频谱。
        if (pipeline.context.state !== 'running') {
          void pipeline.context.resume().then(
            () => setPlaybackRevision(revision => revision + 1),
            () => {},
          )
        }
      })
    }
    // 非手势路径（原生事件、后挂载）：只复用既有管线，绝不创建——
    // 在事件回调中创建的 context 无法获批运行，接管即冻结播放。
    const onStart = () => {
      // store 的 isPlaying 在 audio.play() 前可能已经是 true；用原生事件重启绘制。
      bind(getExistingAnalysisPipeline(audio))
    }
    const onStop = () => setPlaybackRevision(revision => revision + 1)

    audio.addEventListener('play', onStart)
    audio.addEventListener('playing', onStart)
    audio.addEventListener('pause', onStop)
    audio.addEventListener('ended', onStop)
    // capture 阶段早于 React 的播放按钮 click，确保仍处在用户手势上下文中。
    window.addEventListener('pointerdown', onGesture, { capture: true, passive: true })
    window.addEventListener('touchstart', onGesture, { capture: true, passive: true })
    window.addEventListener('touchend', onGesture, { capture: true, passive: true })
    window.addEventListener('click', onGesture, { capture: true, passive: true })
    // 详情页后挂载时复用底栏已初始化的管线，立即开始绘制；尚无管线则渲染合成动画，
    // 等下个手势接管（iOS 永远走合成，见 audio-analysis 的禁用说明）。
    bind(getExistingAnalysisPipeline(audio))

    return () => {
      audio.removeEventListener('play', onStart)
      audio.removeEventListener('playing', onStart)
      audio.removeEventListener('pause', onStop)
      audio.removeEventListener('ended', onStop)
      window.removeEventListener('pointerdown', onGesture, { capture: true })
      window.removeEventListener('touchstart', onGesture, { capture: true })
      window.removeEventListener('touchend', onGesture, { capture: true })
      window.removeEventListener('click', onGesture, { capture: true })
      analyserRef.current = null
    }
  }, [audio])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // null = 尚无/无法接管分析管线（iOS、接管失败的内核、手势前的首帧）→ 合成动画。
    const analyser = analyserRef.current

    const context = canvas.getContext('2d')
    if (!context) return

    const frequencyData = new Uint8Array(analyser ? analyser.frequencyBinCount : SPECTRUM_SYNTH_BINS)
    // 合成模式的复用缓冲，避免逐帧分配；lerp 平滑等价 smoothingTimeConstant。
    const synthTarget = analyser ? null : new Uint8Array(frequencyData.length)
    let frame: number | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let width = 0
    let height = 0
    let dpr = 1
    const targetLevel = isPlaying ? 1 : 0
    const startLevel = visualLevelRef.current
    const transitionStart = performance.now()
    const transitionDuration = targetLevel > startLevel ? 420 : 360

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      const nextWidth = Math.floor(width * dpr)
      const nextHeight = Math.floor(height * dpr)
      if (canvas.width === nextWidth && canvas.height === nextHeight) return
      canvas.width = nextWidth
      canvas.height = nextHeight
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (now: number) => {
      if (canvas.offsetParent === null) {
        context.clearRect(0, 0, width, height)
        frame = null
        return
      }

      const progress = Math.min(1, (now - transitionStart) / transitionDuration)
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2
      const visualLevel = startLevel + (targetLevel - startLevel) * eased
      visualLevelRef.current = visualLevel

      if (analyser) {
        analyser.getByteFrequencyData(frequencyData)
      } else if (synthTarget) {
        spectrumSynth(synthTarget, now)
        for (let i = 0; i < frequencyData.length; i++) {
          frequencyData[i] += Math.round((synthTarget[i] - frequencyData[i]) * 0.22)
        }
      }
      context.clearRect(0, 0, width, height)
      context.fillStyle = getComputedStyle(canvas).color

      // 两处频谱统一为 4px 节距（3px 柱 + 1px 间隔），从底部向上生长。
      // 不设上限，宽画布也维持相同的柱宽而不会变粗。
      const count = Math.max(24, Math.floor(width / 4))
      const gap = 1
      const barWidth = Math.max(1, (width - gap * (count - 1)) / count)
      const sourceRange = Math.max(1, Math.floor(frequencyData.length * 0.68))

      for (let i = 0; i < count; i++) {
        const dataIndex = Math.min(sourceRange - 1, Math.floor((i / count) * sourceRange))
        const amplitude = frequencyData[dataIndex] / 255
        const barHeight = amplitude * visualLevel * height
        if (barHeight < 0.5) continue
        const x = i * (barWidth + gap)
        context.fillRect(x, height - barHeight, barWidth, barHeight)
      }

      if (targetLevel === 0 && progress === 1) {
        context.clearRect(0, 0, width, height)
        frame = null
        return
      }
      frame = requestAnimationFrame(draw)
    }

    // 单一画布在窗口拖拽时会由 CSS 自动拉伸；等待尺寸稳定后再更新位图分辨率，
    // 避免每个 resize 事件都清空画布造成频谱闪烁。
    const scheduleResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        resize()
      }, 120)
    }
    // 夸克、部分系统浏览器的旧内核没有 ResizeObserver，退回 window resize。
    const ResizeObserverClass = window.ResizeObserver
    const observer = ResizeObserverClass ? new ResizeObserverClass(scheduleResize) : null
    if (observer) observer.observe(canvas)
    else window.addEventListener('resize', scheduleResize)
    resize()

    frame = requestAnimationFrame(draw)
    return () => {
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', scheduleResize)
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [audio, isPlaying, playbackRevision])

  return <canvas ref={canvasRef} aria-hidden="true" className={`block w-full text-primary opacity-50 ${className}`} />
}
