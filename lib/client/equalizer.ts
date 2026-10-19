/** 图形 EQ：半增益带宽校准、中心频点交互补偿；RBJ peaking 模型。 */
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export interface EqualizerSettings {
  enabled: boolean
  preset: string
  bands: number[]
  preamp: number
  autoPreamp: boolean
}
export interface SavedEqualizer { id: string; name: string; bands: number[]; preamp: number; autoPreamp: boolean }
export interface EqualizerConfig { version: 1; settings: EqualizerSettings; saved: SavedEqualizer[] }
export const EQ_PRESETS = [
  { id: 'flat', name: '平衡 · Flat', bands: [0,0,0,0,0,0,0,0,0,0] },
  { id: 'pop', name: '流行 · Pop', bands: [-1,1,3,4,2,0,-1,1,2,2] },
  { id: 'rock', name: '摇滚 · Rock', bands: [4,3,2,-1,-2,0,2,3,4,3] },
  { id: 'classical', name: '古典 · Classical', bands: [3,2,1,0,-1,-1,0,2,3,3] },
  { id: 'jazz', name: '爵士 · Jazz', bands: [3,2,1,2,-1,-1,0,2,3,2] },
  { id: 'electronic', name: '电子 · Electronic', bands: [5,4,1,0,-2,1,0,2,4,5] },
  { id: 'bass', name: '低音增强 · Bass Boost', bands: [6,5,4,2,0,0,0,0,0,0] },
  { id: 'vocal', name: '人声增强 · Vocal Boost', bands: [-3,-2,-1,1,3,4,3,1,0,-1] },
  { id: 'treble', name: '高音增强 · Treble Boost', bands: [0,0,0,0,0,1,2,4,5,6] },
] as const
export function defaultEqualizer(): EqualizerSettings {
  return { enabled: false, preset: 'flat', bands: Array(10).fill(0), preamp: 0, autoPreamp: true }
}
export const clampDb = (value: number): number => Math.max(-12, Math.min(12, value))
function validBands(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 10 && value.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 12)
}
function validControls(v: Record<string, unknown>): boolean {
  return validBands(v.bands) && typeof v.preamp === 'number' && Number.isFinite(v.preamp) && Math.abs(v.preamp) <= 12 && typeof v.autoPreamp === 'boolean'
}
/** v0（无版本的 settings）迁移到 v1；未来版本及损坏数据安全回退。 */
export function parseEqualizer(raw: string | null): EqualizerConfig {
  const fallback: EqualizerConfig = { version: 1, settings: defaultEqualizer(), saved: [] }
  try {
    const data = JSON.parse(raw || 'null')
    if (!data || typeof data !== 'object' || (data.version !== undefined && data.version !== 1)) return fallback
    const settings = data.version === 1 ? data.settings : data
    if (!settings || !validControls(settings) || typeof settings.enabled !== 'boolean') return fallback
    const saved: SavedEqualizer[] = Array.isArray(data.saved) ? data.saved.filter((v: unknown) => {
      if (!v || typeof v !== 'object') return false
      const item = v as Record<string, unknown>
      return typeof item.id === 'string' && item.id.startsWith('user-') && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 40 && validControls(item)
    }).slice(0, 20) : []
    const known = EQ_PRESETS.find(p => p.id === settings.preset) ?? saved.find(p => p.id === settings.preset)
    const preset = known && known.bands.every((v, i) => v === settings.bands[i]) ? settings.preset : 'custom'
    return { version: 1, settings: { enabled: settings.enabled, preset, bands: [...settings.bands], preamp: settings.preamp, autoPreamp: settings.autoPreamp }, saved }
  } catch { return fallback }
}
export function responseFrequencies(sampleRate: number, count = 1024): Float32Array<ArrayBuffer> {
  const top = sampleRate * 0.499
  return Float32Array.from({ length: count }, (_, i) => 10 * Math.pow(top / 10, i / (count - 1)))
}
export function filterFrequency(frequency: number, sampleRate: number): number {
  return Math.min(frequency, sampleRate * 0.49)
}
const qCache = new Map<number, number[]>()
export function isBandAvailable(index: number, sampleRate: number): boolean {
  return EQ_FREQUENCIES[index] < sampleRate * 0.49
}
/** 精确求数字滤波器半增益边界的频率比为 2；包含 BLT 高频扭曲。 */
export function filterQ(index: number, sampleRate: number): number {
  let values = qCache.get(sampleRate)
  if (!values) {
    values = EQ_FREQUENCIES.map(frequency => {
      const tangent = Math.tan(Math.PI * filterFrequency(frequency, sampleRate) / sampleRate)
      let low = 0.01, high = 4
      for (let iteration = 0; iteration < 40; iteration++) {
        const q = (low + high) / 2
        const root = Math.sqrt(1 + 1 / (4 * q * q))
        const lower = Math.atan(tangent / (root + 1 / (2 * q)))
        const upper = Math.atan(tangent * (root + 1 / (2 * q)))
        if (Math.log2(upper / lower) > 1) low = q
        else high = q
      }
      return (low + high) / 2
    })
    if (qCache.size >= 8) qCache.delete(qCache.keys().next().value!)
    qCache.set(sampleRate, values)
  }
  return values[index]
}
export function equalizerResponse(bands: readonly number[], sampleRate: number, frequencies = responseFrequencies(sampleRate)): number[] {
  const coefficients = bands.map((requestedGain, index) => {
    const gain = isBandAvailable(index, sampleRate) ? requestedGain : 0
    const a = Math.pow(10, gain / 40)
    const w = 2 * Math.PI * filterFrequency(EQ_FREQUENCIES[index], sampleRate) / sampleRate
    const alpha = Math.sin(w) / (2 * filterQ(index, sampleRate))
    return { b: [1 + alpha * a, -2 * Math.cos(w), 1 - alpha * a], d: [1 + alpha / a, -2 * Math.cos(w), 1 - alpha / a] }
  })
  return Array.from(frequencies, frequency => {
    const angle = 2 * Math.PI * frequency / sampleRate
    const cos = Math.cos(angle), sin = Math.sin(angle), cos2 = Math.cos(2 * angle), sin2 = Math.sin(2 * angle)
    const power = (c: number[]) => Math.pow(c[0] + c[1] * cos + c[2] * cos2, 2) + Math.pow(c[1] * sin + c[2] * sin2, 2)
    return coefficients.reduce((sum, { b, d }) => sum + 10 * Math.log10(Math.max(1e-24, power(b) / power(d))), 0)
  })
}

export interface EqualizerDesign { gains: readonly number[]; maxError: number }
const designCache = new Map<string, EqualizerDesign>()

function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const rows = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < rows.length; col++) {
    let pivot = col
    for (let i = col + 1; i < rows.length; i++) if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i
    if (Math.abs(rows[pivot][col]) < 1e-8) return null
    ;[rows[pivot], rows[col]] = [rows[col], rows[pivot]]
    const scale = rows[col][col]
    for (let j = col; j <= rows.length; j++) rows[col][j] /= scale
    for (let i = 0; i < rows.length; i++) {
      if (i === col) continue
      const factor = rows[i][col]
      for (let j = col; j <= rows.length; j++) rows[i][j] -= factor * rows[col][j]
    }
  }
  return rows.map(row => row[rows.length])
}

/** 阻尼 Newton 迭代求实际节点增益，使级联中心频响匹配滑块目标。
 * 内部 ±24dB 限幅与最多 10 次迭代保证有界；设置仍严格为 ±12dB。
 */
export function designEqualizer(bands: readonly number[], sampleRate: number): EqualizerDesign {
  const key = `${sampleRate}:${bands.join(',')}`
  const cached = designCache.get(key)
  if (cached) return cached
  const indices = EQ_FREQUENCIES.map((_, i) => i).filter(i => isBandAvailable(i, sampleRate))
  const frequencies = Float32Array.from(indices.map(i => EQ_FREQUENCIES[i]))
  let gains = bands.map((v, i) => isBandAvailable(i, sampleRate) ? v : 0)
  const errorFor = (values: number[]) => equalizerResponse(values, sampleRate, frequencies).map((v, j) => bands[indices[j]] - v)
  let error = errorFor(gains)
  let maximum = Math.max(0, ...error.map(Math.abs))
  for (let iteration = 0; iteration < 10 && maximum > 0.005; iteration++) {
    const columns = indices.map(index => {
      const perturbed = [...gains]; perturbed[index] += 0.05
      const next = errorFor(perturbed)
      return next.map((v, i) => (error[i] - v) / 0.05)
    })
    const jacobian = indices.map((_, i) => columns.map(column => column[i]))
    const step = solveLinear(jacobian, error)
    if (!step) break
    let accepted = false
    for (const damping of [1, 0.5, 0.25, 0.125]) {
      const next = [...gains]
      indices.forEach((index, j) => { next[index] = Math.max(-24, Math.min(24, gains[index] + damping * step[j])) })
      const residual = errorFor(next)
      const candidate = Math.max(0, ...residual.map(Math.abs))
      if (candidate < maximum) {
        gains = next; error = residual; maximum = candidate; accepted = true
        break
      }
    }
    if (!accepted) break
  }
  const design = { gains: Object.freeze(gains), maxError: maximum }
  if (designCache.size >= 32) designCache.delete(designCache.keys().next().value!)
  designCache.set(key, design)
  return design
}

export function designedResponse(bands: readonly number[], sampleRate: number, frequencies = responseFrequencies(sampleRate)): number[] {
  return equalizerResponse(designEqualizer(bands, sampleRate).gains, sampleRate, frequencies)
}

export function protectionDb(settings: EqualizerSettings, sampleRate: number, gains: readonly number[] = designEqualizer(settings.bands, sampleRate).gains): number {
  if (!settings.enabled || !settings.autoPreamp) return 0
  // 补充中心频率，覆盖低采样率下接近 Nyquist 的窄峰。
  const frequencies = new Float32Array([...responseFrequencies(sampleRate), ...EQ_FREQUENCIES.map(f => filterFrequency(f, sampleRate))])
  const peak = Math.max(0, ...equalizerResponse(gains, sampleRate, frequencies))
  // 额外 0.5dB 余量只在提升时应用；Flat + 0dB 完全透明。
  return Math.min(0, -(peak + settings.preamp + (peak + settings.preamp > 0.001 ? 0.5 : 0))) || 0
}
