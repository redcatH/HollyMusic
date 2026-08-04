import { NextRequest } from 'next/server'
import { resolveMusicInfoById } from '@/lib/db'

/**
 * 分享落地页（服务端渲染 og meta）。
 *
 * 背景：SPA 的静态 index.html title 写死为 "Holly Music" 且无 OG 标签，
 * 微信/QQ/微博等社交平台爬虫不执行 JS，抓 `/?uid=xxx` 永远只拿到应用名。
 * 本路由服务端按 uid 查歌曲信息，返回带正确 og:title/og:image 的 HTML，
 * 爬虫读到歌名；真人浏览器执行 body 里的 JS 跳回 `/?uid=xxx` 由 SPA 自动播放。
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  // 用 Host + X-Forwarded-Proto 构造公网 origin（nginx 反代下拿到真实域名；微信 og:image 需公网绝对 URL）
  const host = request.headers.get('host') || url.host
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const origin = `${proto}://${host}`
  const uid = url.searchParams.get('uid')

  let title = 'Holly Music'
  let description = '多源在线音乐播放器'
  let cover = `${origin}/icons/apple-touch-icon.png`
  let playerUrl = origin // 无 uid 跳首页

  if (uid) {
    const mi = await resolveMusicInfoById(uid).catch(() => null)
    if (mi) {
      title = `${mi.name} - ${mi.singer}`
      description = `${mi.singer} · Holly Music`
      cover = `${origin}/api/cover/${encodeURIComponent(uid)}`
    }
    // 无论是否查到，有 uid 就跳播放器（前端 playByUid 会处理找不到的情况）
    playerUrl = `${origin}/?uid=${encodeURIComponent(uid)}`
  }

  // ponytail: og:url 用相对路径，避免 origin 协议判断错误导致 canonical 与实际 URL 不一致
  const ogUrl = uid ? `/api/share?uid=${encodeURIComponent(uid)}` : `/api/share`

  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const img = escapeHtml(cover)
  const canonical = escapeHtml(ogUrl)
  const playerHref = escapeHtml(playerUrl)     // <meta refresh> + <noscript> href 用 HTML 转义

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title>
<meta property="og:type" content="music.song">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Holly Music">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0;url=${playerHref}">
</head>
<body>
<noscript><a href="${playerHref}">打开 Holly Music</a></noscript>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
