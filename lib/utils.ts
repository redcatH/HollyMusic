import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalize a size value into bytes (string of integer bytes).
 * Accepts numbers, numeric strings (with commas), or strings with units (B, KB, MB, GB, TB).
 * Falls back to extracting digits or returning '0' on failure.
 */
export function normalizeSizeToBytes(raw: unknown): string {
  if (raw === null || raw === undefined) return '0'
  if (typeof raw === 'number') return String(Math.floor(raw))

  const sraw = String(raw).trim()
  if (!sraw) return '0'

  // pure numeric string (may contain commas)
  const numericOnly = sraw.replace(/,/g, '')
  if (/^\d+$/.test(numericOnly)) return String(Math.floor(parseInt(numericOnly, 10)))

  // try unit-based formats like '8.7 MB' or '1024 KB'
  const m = sraw.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i)
  if (m) {
    const n = parseFloat(m[1]) || 0
    const unit = (m[2] || 'B').toUpperCase()
    const mulMap: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }
    const mul = mulMap[unit] || 1
    return String(Math.floor(n * mul))
  }

  // fallback: extract digits and parse
  const digits = sraw.replace(/[^\d.]/g, '')
  const v = parseFloat(digits)
  return isNaN(v) ? '0' : String(Math.floor(v))
}
