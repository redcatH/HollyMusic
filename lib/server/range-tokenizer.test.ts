import { describe, expect, it, vi } from 'vitest'
import { RangeTokenizer } from './range-tokenizer'

const CHUNK = 64 * 1024

/** 内容等于「字节序号 mod 251」的虚拟文件，便于核对每次读到的位置。 */
function virtualFile(size: number) {
  const read = vi.fn(async (start: number, length: number) => {
    const data = Buffer.alloc(length)
    for (let i = 0; i < length; i++) data[i] = (start + i) % 251
    return data
  })
  return { size, read, open: () => new RangeTokenizer({ size, read }) }
}
const byteAt = (offset: number) => offset % 251
const peek = (tokenizer: RangeTokenizer, position: number, length: number, mayBeLess = false) => {
  const target = Buffer.alloc(length)
  return tokenizer.peekBuffer(target, { position, mayBeLess }).then(count => ({ bytes: target.subarray(0, count), count }))
}

describe('按区间读取的分词器', () => {
  it('只读取被访问的块，同一块不重复请求', async () => {
    const file = virtualFile(10 * CHUNK)
    const tokenizer = file.open()
    expect(tokenizer.readFailure).toBeNull()
    expect((await peek(tokenizer, 0, 4)).bytes).toEqual(Buffer.from([0, 1, 2, 3]))
    expect((await peek(tokenizer, CHUNK + 7, 4)).bytes[0]).toBe(byteAt(CHUNK + 7))
    expect((await peek(tokenizer, 9, 4)).bytes[0]).toBe(9)
    expect(file.read.mock.calls).toEqual([[0, CHUNK], [CHUNK, CHUNK]])
    expect(tokenizer.usage).toEqual({ rangeRequests: 2, rangeBytes: 2 * CHUNK })
  })

  it('跨块的读取由相邻块拼成', async () => {
    const file = virtualFile(4 * CHUNK)
    const tokenizer = file.open()
    const { bytes, count } = await peek(tokenizer, CHUNK - 3, 8)
    expect(count).toBe(8)
    expect([...bytes]).toEqual(Array.from({ length: 8 }, (_, i) => byteAt(CHUNK - 3 + i)))
    expect(file.read).toHaveBeenCalledTimes(2)
  })

  it('最后一块按文件实际长度读取', async () => {
    const file = virtualFile(2 * CHUNK + 100)
    const tokenizer = file.open()
    const { bytes } = await peek(tokenizer, 2 * CHUNK, 100)
    expect(bytes).toHaveLength(100)
    expect(bytes[99]).toBe(byteAt(file.size - 1))
    expect(file.read.mock.calls).toEqual([[2 * CHUNK, 100]])
  })

  it('已取到的开头填入后不再请求，只复用被完整覆盖的块', async () => {
    const file = virtualFile(4 * CHUNK)
    const head = await file.read(0, CHUNK + 10)
    file.read.mockClear()
    const tokenizer = file.open()
    tokenizer.prefill(0, head.subarray(0, 100))
    await peek(tokenizer, 50, 4)
    expect(file.read).toHaveBeenCalledTimes(1)
    tokenizer.prefill(0, head)
    await peek(tokenizer, 60, 4)
    expect(file.read).toHaveBeenCalledTimes(1)
    await peek(tokenizer, CHUNK + 4, 4)
    expect(file.read.mock.calls).toEqual([[0, CHUNK], [CHUNK, CHUNK]])
  })

  it('跳过数据只推进位置，不产生读取', async () => {
    const file = virtualFile(8 * CHUNK)
    const tokenizer = file.open()
    expect(await tokenizer.ignore(5 * CHUNK)).toBe(5 * CHUNK)
    expect((await peek(tokenizer, tokenizer.position, 4)).bytes[0]).toBe(byteAt(5 * CHUNK))
    expect(file.read.mock.calls).toEqual([[5 * CHUNK, CHUNK]])
  })

  it('顺序读取从当前位置继续', async () => {
    const file = virtualFile(4 * CHUNK)
    const tokenizer = file.open()
    await tokenizer.ignore(CHUNK + 2)
    const target = Buffer.alloc(8)
    expect(await tokenizer.readBuffer(target)).toBe(8)
    expect(target[0]).toBe(byteAt(CHUNK + 2))
    expect(tokenizer.position).toBe(CHUNK + 10)
    expect(file.read.mock.calls).toEqual([[CHUNK, CHUNK]])
  })

  it('越过文件末尾的读取按读到末尾处理', async () => {
    const tokenizer = virtualFile(100).open()
    await expect(peek(tokenizer, 90, 20)).rejects.toMatchObject({ name: 'EndOfStreamError' })
    expect((await peek(tokenizer, 90, 20, true)).count).toBe(10)
    expect((await peek(tokenizer, 150, 4, true)).count).toBe(0)
  })

  it('声明不能随机访问，回读已被越过的位置会被拒绝', async () => {
    const tokenizer = virtualFile(CHUNK).open()
    expect(tokenizer.supportsRandomAccess()).toBe(false)
    expect(tokenizer.fileInfo).toEqual({ size: CHUNK })
    await tokenizer.readBuffer(Buffer.alloc(10))
    await expect(peek(tokenizer, 5, 4)).rejects.toThrow(/greater than/)
  })

  it('同时读取同一块只请求一次', async () => {
    const file = virtualFile(4 * CHUNK)
    const tokenizer = file.open()
    const results = await Promise.all([peek(tokenizer, 2 * CHUNK, 4), peek(tokenizer, 2 * CHUNK + 9, 4)])
    expect(results.map(result => result.bytes[0])).toEqual([byteAt(2 * CHUNK), byteAt(2 * CHUNK + 9)])
    expect(file.read).toHaveBeenCalledTimes(1)
  })

  it('追加读取达到上限后拒绝继续', async () => {
    const tokenizer = virtualFile(70 * CHUNK).open()
    for (let i = 0; i < 64; i++) await peek(tokenizer, i * CHUNK, 1)
    await expect(peek(tokenizer, 64 * CHUNK, 1)).rejects.toMatchObject({
      code: 'AUDIO_PROBE_LIMIT', details: { rangeRequests: 64, rangeBytes: 64 * CHUNK },
    })
    expect(tokenizer.readFailure).toMatchObject({ code: 'AUDIO_PROBE_LIMIT' })
  })

  it('上游返回的字节不足时按读到末尾处理，且不缓存该块', async () => {
    const read = vi.fn(async (_start: number, length: number) => Buffer.alloc(length - 1))
    const tokenizer = new RangeTokenizer({ size: 3 * CHUNK, read })
    await expect(peek(tokenizer, 10, 4)).rejects.toMatchObject({ name: 'EndOfStreamError' })
    read.mockImplementation(async (_start: number, length: number) => Buffer.alloc(length))
    expect((await peek(tokenizer, 10, 4)).count).toBe(4)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('关闭后释放缓存', async () => {
    const file = virtualFile(2 * CHUNK)
    const tokenizer = file.open()
    await peek(tokenizer, 0, 4)
    await tokenizer.close()
    await peek(tokenizer, 0, 4)
    expect(file.read).toHaveBeenCalledTimes(2)
  })
})
