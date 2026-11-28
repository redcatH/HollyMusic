/**
 * 按区间读取的分词器：把可分段读取的数据源呈现给 music-metadata，由解析器自己决定读哪里。
 *
 * 探测只取文件开头时，MP4/M4A 的媒体数据盒子（mdat）会超出采样，而 parseBuffer 把采样当成
 * 整个文件，读到它就因盒子越界整体失败。换成本分词器后解析器知道文件的真实大小，按盒子声明
 * 的大小跳过 mdat，只取回元数据所在的区间——与 ffprobe、浏览器内核读取远程 MP4 的方式一致。
 *
 * 数据按固定大小的块缓存，已取到的开头可直接填入，开头就能解析完的文件不产生额外读取。
 */

import { AbstractTokenizer, EndOfStreamError, type IReadChunkOptions, type ITokenizerOptions } from 'strtok3'
import { PlaybackError } from '@/lib/server/playback-diagnostics'

const CHUNK_SIZE = 64 * 1024
/** 最多追加读取的块数（4 MiB）：元数据异常庞大时继续读取得不偿失。 */
const MAX_READ_COUNT = 64

export interface RangeSource {
  /** 文件总字节数 */
  size: number
  /** 读取 [start, start + length)，应返回恰好 length 字节 */
  read(start: number, length: number): Promise<Uint8Array>
}

export class RangeTokenizer extends AbstractTokenizer {
  fileInfo: { size: number }
  private readonly chunks = new Map<number, Promise<Uint8Array>>()
  private requests = 0
  private bytes = 0
  private failure: unknown = null

  constructor(private readonly source: RangeSource, options?: ITokenizerOptions) {
    super(options)
    this.fileInfo = { size: source.size }
  }

  /** 追加读取的次数与字节数，仅用于诊断。 */
  get usage(): { rangeRequests: number; rangeBytes: number } {
    return { rangeRequests: this.requests, rangeBytes: this.bytes }
  }

  /** 最近一次读取失败的原因。music-metadata 把「读不到下一个盒子」当作文件结束，调用方可据此还原。 */
  get readFailure(): unknown {
    return this.failure
  }

  /** 填入已经取到的 [start, start + data.length)；只有被它完整覆盖的块会被复用。 */
  prefill(start: number, data: Uint8Array): void {
    const end = start + data.length
    for (let index = Math.floor(start / CHUNK_SIZE); index * CHUNK_SIZE < end; index++) {
      const from = index * CHUNK_SIZE
      const to = Math.min(from + CHUNK_SIZE, this.source.size)
      if (from >= start && to <= end && !this.chunks.has(index)) {
        this.chunks.set(index, Promise.resolve(data.subarray(from - start, to - start)))
      }
    }
  }

  supportsRandomAccess(): boolean {
    // 解析只需向前推进与跳过。声明随机访问只会让它额外读一次文件尾部去找 ID3v1/APE 标签。
    return false
  }

  async readBuffer(target: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    const read = this.normalizeOptions(target, options)
    const count = await this.peekBuffer(target, read)
    this.position = read.position + count
    return count
  }

  async peekBuffer(target: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    const { length, position, mayBeLess } = this.normalizeOptions(target, options)
    const count = Math.max(0, Math.min(this.fileInfo.size - position, length))
    if (!mayBeLess && count < length) throw new EndOfStreamError()
    target.set(await this.bytesAt(position, count))
    return count
  }

  protected async closeOnce(): Promise<void> {
    this.chunks.clear()
    await super.closeOnce()
  }

  private async bytesAt(start: number, length: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    const end = start + length
    for (let offset = start; offset < end;) {
      const chunkStart = Math.floor(offset / CHUNK_SIZE) * CHUNK_SIZE
      const chunk = await this.chunk(chunkStart / CHUNK_SIZE)
      const slice = chunk.subarray(offset - chunkStart, Math.min(chunk.length, end - chunkStart))
      if (slice.length === 0) throw new EndOfStreamError()
      parts.push(slice)
      offset += slice.length
    }
    const bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts)
    if (bytes.length !== length) throw new EndOfStreamError()
    return bytes
  }

  private chunk(index: number): Promise<Uint8Array> {
    let chunk = this.chunks.get(index)
    if (!chunk) {
      chunk = this.load(index).catch((error: unknown) => {
        this.chunks.delete(index)
        this.failure = error
        throw error
      })
      this.chunks.set(index, chunk)
    }
    return chunk
  }

  private async load(index: number): Promise<Uint8Array> {
    const start = index * CHUNK_SIZE
    const length = Math.min(CHUNK_SIZE, this.source.size - start)
    if (this.requests >= MAX_READ_COUNT) {
      throw new PlaybackError('AUDIO_PROBE_LIMIT', '音频元数据超出探测上限', this.usage)
    }
    this.requests++
    const data = await this.source.read(start, length)
    this.bytes += data.length
    if (data.length !== length) throw new EndOfStreamError()
    return data
  }
}
