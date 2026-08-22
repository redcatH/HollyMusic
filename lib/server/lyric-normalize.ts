/**
 * 将部分音源返回的“结构化歌词 JSON 字符串”还原为普通 LRC / 文本歌词。
 *
 * 正常的音源契约是返回 LRC 字符串，但部分实现会把
 * `[{ lang, synced, line: [{ text, start }] }]` 直接 JSON.stringify 后放入
 * `lyric` 字段。前端可自行容错，而 Subsonic 客户端会将这段 JSON 当歌词显示。
 * 本模块仅在服务端音源适配层使用，避免将解析逻辑打入客户端 bundle。
 */

type StructuredLyricLine = {
  start?: unknown
  time?: unknown
  text?: unknown
  value?: unknown
}

type StructuredLyricTrack = {
  lang?: unknown
  kind?: unknown
  synced?: unknown
  line?: unknown
}

function formatLrcTimestamp(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  const fraction = total % 1_000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`
}

function getTracks(value: unknown): StructuredLyricTrack[] | null {
  if (Array.isArray(value)) return value as StructuredLyricTrack[]
  if (!value || typeof value !== 'object') return null

  const object = value as Record<string, unknown>
  if (Array.isArray(object.structuredLyrics)) return object.structuredLyrics as StructuredLyricTrack[]
  if (Array.isArray(object.lyrics)) return object.lyrics as StructuredLyricTrack[]
  return null
}

function stripPlainTextMarker(value: string): string {
  return value.replace(/^\[!text\]\s*/i, '').trim()
}

/**
 * 若 text 是已知的结构化歌词 JSON，则将其转换成 LRC（有时间轴）或纯文本。
 * 无法确认结构时原样返回，避免误伤以 `{` / `[` 开头的正常歌词。
 */
export function normalizeStructuredLyricText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || (trimmed[0] !== '[' && trimmed[0] !== '{')) return stripPlainTextMarker(trimmed)

  try {
    const tracks = getTracks(JSON.parse(trimmed))
    if (!tracks) return stripPlainTextMarker(trimmed)

    const track = tracks.find(item => item?.kind === 'main')
      ?? tracks.find(item => typeof item?.lang === 'string' && item.lang.toLowerCase().startsWith('zh'))
      ?? tracks[0]
    if (!track || !Array.isArray(track.line)) return stripPlainTextMarker(trimmed)

    const lines = track.line
      .filter((line): line is StructuredLyricLine => Boolean(line) && typeof line === 'object')
      .map(line => {
        const content = line.text ?? line.value
        if (typeof content !== 'string' || !content.trim()) return null
        // LX 纯文本歌词标记只供前端解析，Subsonic 客户端应收到可直接展示的正文。
        const lyricLine = content.trim().replace(/^\[!text\]/i, '').trim()
        if (!lyricLine) return null

        const timestamp = line.start ?? line.time
        const milliseconds = typeof timestamp === 'number'
          ? timestamp
          : typeof timestamp === 'string' && timestamp.trim() !== ''
            ? Number(timestamp)
            : Number.NaN

        return Number.isFinite(milliseconds)
          ? `[${formatLrcTimestamp(milliseconds)}]${lyricLine}`
          : lyricLine
      })
      .filter((line): line is string => line !== null)

    return lines.length > 0 ? lines.join('\n') : stripPlainTextMarker(trimmed)
  } catch {
    return stripPlainTextMarker(trimmed)
  }
}
