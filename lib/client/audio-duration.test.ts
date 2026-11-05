import { expect, it, vi } from 'vitest'
import { readAudioDuration } from './audio-duration'

/** 合法 PCM WAV，用帧数验证实际时长，无需网络或外部样本。 */
function wav(seconds: number): Response {
  const sampleRate = 8000
  const length = seconds * sampleRate * 2
  const bytes = Buffer.alloc(44 + length)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + length, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(length, 40)
  return new Response(bytes, { headers: { 'content-type': 'audio/wav', 'content-length': String(bytes.length) } })
}

it.each([30, 180])('从真实音频流解析 %s 秒，不信任歌曲标签或 HTTP 时长声明', async seconds => {
  const response = wav(seconds)
  response.headers.set('x-holly-duration', '999')
  expect(await readAudioDuration(response)).toBe(seconds)
})

it('损坏音频或取消的检查返回未知时长', async () => {
  expect(await readAudioDuration(new Response('broken'))).toBe(0)
  const controller = new AbortController()
  controller.abort()
  const cancel = vi.fn()
  const response = new Response(new ReadableStream({ cancel }))
  expect(await readAudioDuration(response, controller.signal)).toBe(0)
  expect(cancel).toHaveBeenCalledOnce()
})
