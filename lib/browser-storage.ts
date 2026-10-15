/** 浏览器存储边界：业务负责校验与迁移，存储失败不阻断当前会话。 */
export type StorageArea = 'local' | 'session'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getStorage(area: StorageArea): Storage {
  return area === 'local' ? window.localStorage : window.sessionStorage
}

export function readStorageValue(key: string, area: StorageArea = 'local'): string | null {
  try { return getStorage(area).getItem(key) } catch { return null }
}

export function createBrowserStorage<T>(
  key: string,
  parse: (value: unknown) => T | null,
  area: StorageArea = 'local',
  version = 1,
) {
  return {
    key,
    read(): T | null {
      try {
        const envelope: unknown = JSON.parse(readStorageValue(key, area) || 'null')
        return isRecord(envelope) && envelope.version === version ? parse(envelope.data) : null
      } catch { return null }
    },
    write(data: T): boolean {
      try {
        const validated = parse(data)
        if (validated === null) return false
        getStorage(area).setItem(key, JSON.stringify({ version, data: validated }))
        return true
      } catch { return false }
    },
    remove(): void {
      try { getStorage(area).removeItem(key) } catch { /* 存储不可用时保留内存功能。 */ }
    },
  }
}
