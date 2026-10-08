import { create } from 'zustand'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePalette = 'forest' | 'blue' | 'apricot'

export interface AppearanceSettings {
  mode: ThemeMode
  palette: ThemePalette
  coverAtmosphere: boolean
}

export const APPEARANCE_STORAGE_KEY = 'holly-appearance'
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  mode: 'system',
  palette: 'forest',
  coverAtmosphere: true,
}

/** 与首屏 theme-init.js 保持一致；损坏或旧版本的偏好逐项回退。 */
export function parseAppearance(raw: string | null): AppearanceSettings {
  try {
    const value: unknown = JSON.parse(raw || 'null')
    if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE }
    const settings = value as Partial<AppearanceSettings>
    return {
      mode: settings.mode === 'light' || settings.mode === 'dark' ? settings.mode : 'system',
      palette: settings.palette === 'blue' || settings.palette === 'apricot' ? settings.palette : 'forest',
      coverAtmosphere: typeof settings.coverAtmosphere === 'boolean' ? settings.coverAtmosphere : true,
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

function readAppearance(): AppearanceSettings {
  try {
    return parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY))
  } catch {
    // 隐私模式或存储不可用时，仍可在当前会话切换主题。
    return { ...DEFAULT_APPEARANCE }
  }
}

interface AppearanceStore extends AppearanceSettings {
  systemDark: boolean
  update: (settings: Partial<AppearanceSettings>) => void
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  ...readAppearance(),
  systemDark: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false,
  update: settings => {
    const current = get()
    const next: AppearanceSettings = {
      mode: settings.mode ?? current.mode,
      palette: settings.palette ?? current.palette,
      coverAtmosphere: settings.coverAtmosphere ?? current.coverAtmosphere,
    }
    set(next)
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 主题切换不依赖持久化成功。
    }
  },
}))
