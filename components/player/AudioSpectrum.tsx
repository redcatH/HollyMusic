import { useEffect, useRef, useState } from 'react'

interface AudioSpectrumProps {
  audio: HTMLAudioElement | null
  isPlaying: boolean
  className?: string
}

interface AudioAnalysisPipeline {
  context: AudioContext
  analyser: AnalyserNode
}

type AudioContextConstructor = new () => AudioContext

/** Safari 旧版仍以 webkitAudioContext 暴露 Web Audio。 */
function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const legacyWindow = window as Window & { webkitAudioContext?: AudioContextConstructor }
  return window.AudioContext ?? legacyWindow.webkitAudioContext ?? null
}

// 同一 Audio 元素只能创建一次 MediaElementSource；桌面/移动布局可能同时挂载，
// 因此按音频元素复用分析管线。
const pipelines = new WeakMap<HTMLAudioElement, AudioAnalysisPipeline>()

function getPipeline(audio: HTMLAudioElement, AudioContextClass: AudioContextConstructor): AudioAnalysisPipeline {
  const existing = pipelines.get(audio)
  if (existing) return existing

  const context = new AudioContextClass()
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.8

  const source = context.createMediaElementSource(audio)
  source.connect(analyser)
  analyser.connect(context.destination)

  const pipeline = { context, analyser }
  pipelines.set(audio, pipeline)
  return pipeline
}

/**
 * 底栏频谱：参考 lxserver 的「全宽细密分块柱状」布局。
 * 播放、暂停之间保留短暂的视觉过渡；画布隐藏后停止绘制，避免后台耗电。
 */
export function AudioSpectrum({ audio, isPlaying, className = '' }: AudioSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  /** 频谱视觉增益独立于音频状态，暂停时可完成淡出而不是立即清空。 */
  const visualLevelRef = useRef(0)
  const [playbackRevision, setPlaybackRevision] = useState(0)

  useEffect(() => {
    if (!audio) return
    const AudioContextClass = getAudioContextConstructor()
    if (!AudioContextClass) return

    let attachedAnalyser: AnalyserNode | null = null
    let resuming = false
    const ensurePipeline = (): AudioAnalysisPipeline | null => {
      try {
        const pipeline = getPipeline(audio, AudioContextClass)
        attachedAnalyser = pipeline.analyser
        analyserRef.current = pipeline.analyser
        return pipeline
      } catch {
        // 某些 Android 浏览器会拒绝在非用户手势中创建 MediaElementSource；下次手势再重试。
        return null
      }
    }

    const resume = () => {
      const pipeline = ensurePipeline()
      if (!pipeline || resuming) return
      if (pipeline.context.state === 'running') return
      resuming = true
      // 必须在 pointer/touch/click 处理期间调用；否则部分移动浏览器会拒绝解锁 AudioContext。
      void pipeline.context.resume()
        .then(() => setPlaybackRevision(revision => revision + 1))
        .catch(() => {})
        .finally(() => {
          resuming = false
        })
    }
    const onStart = () => {
      resume()
      // store 的 isPlaying 在 audio.play() 前可能已经是 true；用原生事件重启绘制。
      setPlaybackRevision(revision => revision + 1)
    }
    const onStop = () => setPlaybackRevision(revision => revision + 1)
    audio.addEventListener('play', onStart)
    audio.addEventListener('playing', onStart)
    audio.addEventListener('pause', onStop)
    audio.addEventListener('ended', onStop)
    // capture 阶段早于 React 的播放按钮 click，确保仍处在用户手势上下文中。
    window.addEventListener('pointerdown', resume, { capture: true, passive: true })
    window.addEventListener('touchstart', resume, { capture: true, passive: true })
    window.addEventListener('touchend', resume, { capture: true, passive: true })
    window.addEventListener('click', resume, { capture: true, passive: true })
    // 详情页后挂载时复用底栏已初始化的管线，立即开始绘制。
    if (pipelines.has(audio)) {
      ensurePipeline()
    }
    if (!audio.paused) resume()

    return () => {
      audio.removeEventListener('play', onStart)
      audio.removeEventListener('playing', onStart)
      audio.removeEventListener('pause', onStop)
      audio.removeEventListener('ended', onStop)
      window.removeEventListener('pointerdown', resume, true)
      window.removeEventListener('touchstart', resume, true)
      window.removeEventListener('touchend', resume, true)
      window.removeEventListener('click', resume, true)
      if (analyserRef.current === attachedAnalyser) analyserRef.current = null
    }
  }, [audio])

  useEffect(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const context = canvas.getContext('2d')
    if (!context) return

    const frequencyData = new Uint8Array(analyser.frequencyBinCount)
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

      analyser.getByteFrequencyData(frequencyData)
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
