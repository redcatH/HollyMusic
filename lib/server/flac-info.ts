/** FLAC STREAMINFO 的采样率、声道数和位深位于文件头的同一个 32 位字。 */
export function formatFlacSpec(data: Buffer): string | undefined {
  if (data.length < 22 || data.toString('ascii', 0, 4) !== 'fLaC' || (data[4] & 127) !== 0
    || data.readUIntBE(5, 3) !== 34) return
  const flags = data.readUInt32BE(18)
  const sampleRate = flags >>> 12
  if (!sampleRate) return
  const channels = ((flags >>> 9) & 7) + 1
  const depth = ((flags >>> 4) & 31) + 1
  return `${depth} bit / ${sampleRate / 1000} kHz / ${channels} ch`
}
