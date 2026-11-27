export class PlaybackError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>, cause?: unknown) {
    super(message, { cause })
    this.name = 'PlaybackError'
  }
}

export function describePlaybackError(error: unknown): { name: string; message: string } {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误'
  return {
    name: error instanceof Error ? error.name.replace(/[^\w.-]/g, '').slice(0, 80) || 'Error' : 'Error',
    message: message
      .replace(/(?:https?:)?\/\/[^\s"'<>]+/gi, '[URL]')
      .replace(/\b(?:bearer|basic)\s+[\w+/.=-]+/gi, '[凭证]')
      .replace(/\bCERU_KEY[-\w]+/gi, '[凭证]')
      .replace(/(["']?\b(?:api[-_ ]?key|access[-_ ]?token|token|signature|authorization|cookie|secret|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\r\n;}]+)/gi, '$1[已省略]')
      .replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}
