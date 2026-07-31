/**
 * 一次性脚本：用 sharp 把 SVG 渲染成 PWA 需要的各尺寸 PNG。
 * 用完即删，不进构建流程。运行：node scripts/gen-pwa-icons.mjs
 */
import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pub = resolve(__dirname, '..', 'public')

const baseSvg = readFileSync(resolve(pub, 'icon.svg'))
const maskableSvg = readFileSync(resolve(pub, 'icon-maskable.svg'))

const tasks = [
  { src: baseSvg, size: 192, out: 'icons/icon-192.png' },
  { src: baseSvg, size: 512, out: 'icons/icon-512.png' },
  { src: baseSvg, size: 180, out: 'icons/apple-touch-icon.png' },
  { src: maskableSvg, size: 512, out: 'icons/icon-maskable-512.png' },
]

mkdirSync(resolve(pub, 'icons'), { recursive: true })

for (const t of tasks) {
  await sharp(t.src)
    .resize(t.size, t.size)
    .png()
    .toFile(resolve(pub, t.out))
  console.log('generated:', t.out, t.size + 'x' + t.size)
}
console.log('done')
