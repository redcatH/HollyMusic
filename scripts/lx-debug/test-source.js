#!/usr/bin/env node
/**
 * 通用音源测试脚本 —— 取流 + 真实下载验证，覆盖音源声明的「所有源 × 所有音质」。
 * 拿到 URL 后必须真正下到音频字节才算"可靠/成功"。
 *
 * 用法：
 *   node scripts/lx-debug/test-source.js <音源文件名> [音质]
 *      文件名须是 custom-sources/ 下的完整名（带或不带 .js）
 *      不传音质 → 测该音源声明的全部音质
 *      传音质   → 只测指定音质（如 320k / flac / 24bit）
 * 例：
 *   node scripts/lx-debug/test-source.js my-source.js
 *   node scripts/lx-debug/test-source.js my-source.js flac
 *   node scripts/lx-debug/test-source.js another-source.js
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const needle = require('needle')
const LXEnvironmentSimulator = require('../../lib/music-core/index')

// ── 参数 ───────────────────────────────────────────
const keyword = process.argv[2]
const qualityFilter = process.argv[3] // 可选：不传则测所有音质
if (!keyword) {
  console.error('用法: node scripts/lx-debug/test-source.js <音源文件名> [音质]')
  console.error('例:   node scripts/lx-debug/test-source.js my-source.js')
  console.error('      node scripts/lx-debug/test-source.js my-source.js flac')
  process.exit(1)
}

// ── 定位音源脚本（精确优先，模糊歧义报错）─────────
const SOURCES_DIR = path.resolve(__dirname, '../../custom-sources')
if (!fs.existsSync(SOURCES_DIR)) {
  console.error('找不到目录:', SOURCES_DIR)
  process.exit(1)
}
const files = fs.readdirSync(SOURCES_DIR).filter((f) => /\.js$/i.test(f))
// 精确匹配文件全名（支持带或不带 .js 后缀），不做模糊匹配
const target =
  files.find((f) => f === keyword) ||
  files.find((f) => f === keyword + '.js')
if (!target) {
  console.error(`在 custom-sources/ 下找不到文件 "${keyword}"。请传完整文件名。可选:`)
  files.forEach((f) => console.error('  -', f))
  process.exit(1)
}
const scriptPath = path.join(SOURCES_DIR, target)

// ── 各源测试用歌曲 id（tx/wy/kw→songmid | kg→hash | mg→copyrightId）──
//   某些聚合音源的 mg 链路还要 songName，可按需补字段。
const MUSIC_INFO = {
  wy: { songmid: '190449' },
  kw: { songmid: '157908' },
  mg: { copyrightId: '1140709301' },
  tx: { songmid: '004RDW5Q2ol2jj' },
  kg: { hash: 'D0FAE82D4B5403ED396CFABD14743B15' },
}

// ── 下载验证：拿到真实音频字节才算可靠 ──────────────
const OUT_DIR = path.join(os.tmpdir(), 'lx-source-test')
fs.mkdirSync(OUT_DIR, { recursive: true })

function download(url) {
  return new Promise((resolve) => {
    needle.get(url, { follow_max: 5, response_timeout: 60000, parse: false }, (err, resp) => {
      if (err) return resolve({ ok: false, detail: err.message })
      const body = Buffer.isBuffer(resp.body) ? resp.body : Buffer.from(resp.body || '')
      const ct = resp.headers?.['content-type'] || ''
      const ok = resp.statusCode === 200 && body.length > 10000 && !ct.includes('text/html')
      resolve({ ok, statusCode: resp.statusCode, bytes: body.length, contentType: ct, body })
    })
  })
}
const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, n / 1024).toFixed(0) + 'KB')

// ── 抑制模拟器 [HTTP] 调试日志，只输出结果 ──────────
const write = (s = '') => process.stdout.write(s)
console.log = () => {}
console.error = () => {}

;(async () => {
  write(`\n音源: ${target}\n`)
  write(`脚本: ${scriptPath}\n\n`)

  const sim = new LXEnvironmentSimulator()
  await sim.loadScript(scriptPath)

  // ── 动态构建测试矩阵：音源声明的所有源 × 所有音质 ──
  const sources = sim.getSupportedSources()
  const tests = []
  for (const source of sources) {
    const info = MUSIC_INFO[source]
    if (!info) continue // 没有该源的测试 id
    const qualitys = sim.sourceInfo.sources[source].qualitys || []
    const qs = qualityFilter ? qualitys.filter((q) => q === qualityFilter) : qualitys
    for (const q of qs) tests.push({ source, musicInfo: info, quality: q })
  }
  if (!tests.length) {
    write(`无可测试组合（音源声明源: ${sources.join(', ') || '无'}）\n`)
    return
  }
  write(`支持源: ${sources.join(', ')}\n`)
  write(`测试矩阵: ${tests.length} 项${qualityFilter ? `（仅 ${qualityFilter}）` : '（全部音质）'}\n\n`)

  write('============ 取流 + 下载验证 ============\n')
  let urlOk = 0
  let dlOk = 0
  for (const t of tests) {
    write(`${(t.source + '/' + t.quality).padEnd(12)} `)
    let url
    try {
      url = await sim.getMusicUrl(t.source, t.musicInfo, t.quality)
      urlOk++
    } catch (e) {
      const reason = e?.message || String(e) || '未知错误'
      write(`❌ 取流: ${reason.slice(0, 70)}\n`)
      continue
    }
    write(`✅ 取流 → `)
    const dl = await download(url)
    if (dl.ok) {
      const outFile = path.join(OUT_DIR, `${t.source}_${t.quality}.mp3`)
      fs.writeFileSync(outFile, dl.body)
      write(`✅ 下载 ${fmtBytes(dl.bytes)} (${dl.contentType})\n`)
      dlOk++
    } else {
      const why = dl.detail || `${dl.statusCode} ${fmtBytes(dl.bytes)} (${dl.contentType})`
      write(`❌ 下载: ${why}\n`)
    }
  }
  write(`\n取流 ${urlOk}/${tests.length} | 下载 ${dlOk}/${tests.length}\n`)
  write(`下载目录: ${OUT_DIR}\n`)
})().catch((e) => {
  write(`\n❌ 脚本异常: ${e?.message || String(e)}\n`)
  process.exit(1)
})
