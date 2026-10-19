import { create } from 'zustand'
import { clampDb, defaultEqualizer, EQ_PRESETS, parseEqualizer, type EqualizerConfig, type EqualizerSettings } from '@/lib/client/equalizer'
import type { EqualizerStatus } from '@/lib/client/equalizer-status'

export const EQ_STORAGE_KEY = 'holly-equalizer'
export function readEqualizer(): EqualizerConfig {
  try { return parseEqualizer(localStorage.getItem(EQ_STORAGE_KEY)) } catch { return parseEqualizer(null) }
}
interface EqualizerStore extends EqualizerConfig {
  status: EqualizerStatus
  sampleRate: number
  update: (patch: Partial<EqualizerSettings>) => void
  setBand: (index: number, gain: number) => void
  selectPreset: (id: string) => void
  save: (name: string) => void
  remove: (id: string) => void
  reset: () => void
}
const initial = readEqualizer()
export const useEqualizerStore = create<EqualizerStore>((set, get) => ({
  ...initial, status: initial.settings.enabled ? 'awaiting-gesture' : 'idle', sampleRate: 48000,
  update: patch => set({ settings: { ...get().settings, ...patch } }),
  setBand: (index, gain) => {
    if (index < 0 || index >= 10 || !Number.isFinite(gain)) return
    set({ settings: { ...get().settings, preset: 'custom', bands: get().settings.bands.map((v, i) => i === index ? clampDb(gain) : v) } })
  },
  selectPreset: id => {
    const preset = EQ_PRESETS.find(p => p.id === id) ?? get().saved.find(p => p.id === id)
    if (!preset) { if (id === 'custom') set({ settings: { ...get().settings, preset: id } }); return }
    const controls = 'preamp' in preset ? { preamp: preset.preamp, autoPreamp: preset.autoPreamp } : { preamp: 0, autoPreamp: true }
    set({ settings: { ...get().settings, ...controls, preset: id, bands: [...preset.bands] } })
  },
  save: name => {
    if (!name.trim() || get().saved.length >= 20) return
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { bands, preamp, autoPreamp } = get().settings
    set({ saved: [...get().saved, { id, name: name.trim().slice(0, 40), bands: [...bands], preamp, autoPreamp }], settings: { ...get().settings, preset: id } })
  },
  remove: id => set({ saved: get().saved.filter(p => p.id !== id), settings: { ...get().settings, preset: get().settings.preset === id ? 'custom' : get().settings.preset } }),
  reset: () => set({ settings: { ...defaultEqualizer(), enabled: get().settings.enabled } }),
}))
// 音频订阅同步响应，只有磁盘写入防抖；pagehide 落盘，不依赖 SW 或后台计时器。
let persistTimer: ReturnType<typeof setTimeout> | undefined
function persist(): void {
  clearTimeout(persistTimer)
  const { settings, saved } = useEqualizerStore.getState()
  try { localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify({ version: 1, settings, saved })) } catch { /* 会话内功能保留 */ }
}
useEqualizerStore.subscribe((state, previous) => {
  if (state.settings === previous.settings && state.saved === previous.saved) return
  clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 150)
})
if (typeof window !== 'undefined') window.addEventListener('pagehide', persist)
