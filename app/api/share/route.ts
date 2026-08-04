import { NextRequest } from 'next/server'
import { resolveMusicInfoById } from '@/lib/db'

/**
 * 分享落地页（服务端渲染，卡片式，不自动跳转）。
 *
 * 背景：之前用 JS/meta refresh 自动跳转到 /?uid=xxx，微信爬虫跟随跳转后抓到
 * 静态 index.html 的 <title>Holly Music</title>，覆盖了正确的 og:title。
 *
 * 现方案：返回一个独立的卡片页（含完整 og meta + 歌曲信息 + 播放按钮），
 * 不自动跳转——爬虫只读 og meta 拿到歌名；真人看到卡片，点"播放"才进 SPA。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

const SOURCE_LABEL: Record<string, string> = {
  tx: 'QQ音乐', wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕',
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const host = request.headers.get('host') || url.host
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const origin = `${proto}://${host}`
  const uid = url.searchParams.get('uid')

  // 默认值（查不到歌时降级）
  let title = 'Holly Music'
  let songName = 'Holly Music'
  let artist = '多源在线音乐播放器'
  let metaLine = ''
  let ogImage = `${origin}/icons/apple-touch-icon.png`
  let coverSrc = '/icons/apple-touch-icon.png'
  let playerUrl = origin
  let found = false

  if (uid) {
    const mi = await resolveMusicInfoById(uid).catch(() => null)
    if (mi) {
      found = true
      songName = mi.name
      artist = mi.singer
      title = `${mi.name} - ${mi.singer}`
      ogImage = `${origin}/api/cover/${encodeURIComponent(uid)}`
      coverSrc = `/api/cover/${encodeURIComponent(uid)}`
      const parts: string[] = []
      if (mi.albumName) parts.push(mi.albumName)
      if (SOURCE_LABEL[mi.source]) parts.push(SOURCE_LABEL[mi.source])
      if (mi.interval) parts.push(mi.interval)
      metaLine = parts.join(' · ')
    }
    // 有 uid 就跳播放器（前端 playByUid 处理找不到的情况）
    playerUrl = `${origin}/?uid=${encodeURIComponent(uid)}`
  }

  const t = escapeHtml(title)
  const songNameE = escapeHtml(songName)
  const artistE = escapeHtml(artist)
  const metaE = escapeHtml(metaLine)
  const img = escapeHtml(ogImage)
  const ogUrl = escapeHtml(uid ? `${origin}/api/share?uid=${encodeURIComponent(uid)}` : `${origin}/api/share`)
  const playerHref = escapeHtml(playerUrl)

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>${t}</title>
<meta property="og:type" content="music.song">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${artistE}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${ogUrl}">
<meta property="og:site_name" content="Holly Music">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${artistE}">
<meta name="twitter:image" content="${img}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif;background:radial-gradient(circle at 50% 0%,#1a1a1a,#0a0a0a 70%);color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px env(safe-area-inset-right,24px) calc(24px + env(safe-area-inset-bottom,0px)) env(safe-area-inset-left,24px);-webkit-tap-highlight-color:transparent}
.card{width:100%;max-width:360px;text-align:center}
.cover-link{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6);margin-bottom:28px;background:#1a1a1a}
.cover{width:100%;height:100%;object-fit:cover;display:block}
.cover-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);transition:background .2s}
.play-circle{width:72px;height:72px;border-radius:50%;background:rgba(29,185,84,.92);display:flex;align-items:center;justify-content:center;opacity:0;transform:scale(.8);transition:opacity .2s,transform .2s}
.play-circle svg{width:30px;height:30px;margin-left:3px;fill:#000}
.cover-link:hover .cover-overlay,.cover-link:active .cover-overlay{background:rgba(0,0,0,.45)}
.cover-link:hover .play-circle,.cover-link:active .play-circle{opacity:1;transform:scale(1)}
/* 触屏设备无 hover，播放按钮常驻显示 */
@media (hover:none){.cover-overlay{background:rgba(0,0,0,.25)}.play-circle{opacity:1;transform:scale(1)}}
.title{font-size:22px;font-weight:700;line-height:1.35;margin-bottom:8px;word-break:break-word}
.artist{font-size:16px;color:#b3b3b3;margin-bottom:6px}
.meta{font-size:13px;color:#6a6a6a;margin-bottom:32px;min-height:18px}
.hint{font-size:14px;color:#1DB954;font-weight:600;letter-spacing:.5px}
.brand{margin-top:40px;font-size:13px;color:#6a6a6a;letter-spacing:.5px}
.brand b{color:#1DB954;font-weight:700}
</style>
</head>
<body>
<div class="card">
<a class="cover-link" href="${playerHref}">
<img class="cover" src="${coverSrc}" alt="${songNameE}">
<span class="cover-overlay"><span class="play-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span>
</a>
<h1 class="title">${songNameE}</h1>
<p class="artist">${artistE}</p>
<p class="meta">${metaE}</p>
<p class="hint">点击封面播放</p>
</div>
<div class="brand"><b>♪</b> Holly Music</div>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
