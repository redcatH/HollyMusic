import { logger } from '@/lib/logger'

/** 消费一个独立的本地响应流，只解析元数据；不复制整首音频到内存。 */
export async function readAudioDuration(response: Response, signal?: AbortSignal): Promise<number> {
  try {
    const { parseWebStream } = await import('music-metadata')
    if (!response.body || signal?.aborted) return 0
    const stream = signal ? response.body.pipeThrough(new TransformStream(), { signal }) : response.body
    const metadata = await parseWebStream(stream, {
      mimeType: response.headers.get('content-type') || undefined,
      size: Number(response.headers.get('content-length')) || undefined,
    }, { duration: true, skipCovers: true, skipPostHeaders: true })
    const duration = metadata.format.duration
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0
  } catch (error) {
    if (!signal?.aborted) logger.debug('[offline] 音频时长无法校验，跳过长曲缓存', error)
    return 0
  } finally {
    if (!response.body?.locked) void response.body?.cancel().catch(() => {})
  }
}
