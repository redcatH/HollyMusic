import { NextRequest } from 'next/server'
import { resolveMusicInfoById } from '@/lib/db'
import type { QualityType } from '@/lib/types/music'

/**
 * 分享落地页（服务端渲染，自包含页内播放页）。
 *
 * 背景：之前播放按钮是 <a href="/?uid=xxx">，点击后整页导航到 SPA。
 * 但页面导航会销毁用户手势上下文，SPA 里的 audio.play() 被浏览器
 * Autoplay Policy 判定"无手势"而拦截 → 分享进来不自动播放。
 *
 * 现方案（参考网易云 / QQ 音乐 / Spotify 的单曲落地页）：页内直接内嵌
 * <audio>，用户点播放按钮 → 在同一个 click 事件栈内同步 audio.play()
 * （手势有效，浏览器放行），不跳转。微信内置浏览器额外用 WeixinJSBridge
 * 借手势尝试自动播放；PC 桌面靠 MEI 机制 try play。再加"打开 App /
 * 进入网页版"按钮引导回流 SPA 完整体验。
 *
 * 服务端渲染保留：og meta 供微信爬虫抓取卡片（og:title / og:image 等）。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

const SOURCE_LABEL: Record<string, string> = {
  tx: 'QQ音乐', wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕',
}

/**
 * 落地页选音质：优先 320k（音质/流量平衡），降级 128k。
 * 不主动选 flac/flac24bit——落地页是试听场景，无损流量过大且首播慢。
 * 若歌曲只有无损（罕见），回退到 types 里的第一个；无 types 信息时兜底 320k 交上游决定。
 */
function pickShareQuality(types: { type: QualityType }[]): string {
  const available = new Set(types.map((t) => t.type))
  if (available.has('320k')) return '320k'
  if (available.has('128k')) return '128k'
  if (types.length > 0) return types[0].type
  return '320k'
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
  let interval = ''
  let ogImage = `${origin}/icons/apple-touch-icon.png`
  let coverSrc = '/icons/apple-touch-icon.png'
  let audioSrc = ''
  let playerUrl = origin
  let found = false

  if (uid) {
    const mi = await resolveMusicInfoById(uid).catch(() => null)
    if (mi) {
      found = true
      songName = mi.name
      artist = mi.singer
      title = `${mi.name} - ${mi.singer}`
      interval = mi.interval || ''
      ogImage = `${origin}/api/cover/${encodeURIComponent(uid)}`
      coverSrc = `/api/cover/${encodeURIComponent(uid)}`
      // 音频流 API 无需鉴权，服务端磁盘缓存 + Range 代理，<audio> 直接 GET
      // 按歌曲可用音质选（避免只有 128k 的歌请求 320k 失败）
      audioSrc = `${origin}/api/audio?uid=${encodeURIComponent(uid)}&quality=${pickShareQuality(mi.types)}`
      const parts: string[] = []
      if (mi.albumName) parts.push(mi.albumName)
      if (SOURCE_LABEL[mi.source]) parts.push(SOURCE_LABEL[mi.source])
      if (mi.interval) parts.push(mi.interval)
      metaLine = parts.join(' · ')
    }
    // 有 uid 就提供"进入完整播放器"入口（前端 playByUid 处理找不到的情况）
    playerUrl = `${origin}/?uid=${encodeURIComponent(uid)}`
  }

  const t = escapeHtml(title)
  const songNameE = escapeHtml(songName)
  const artistE = escapeHtml(artist)
  const metaE = escapeHtml(metaLine)
  const img = escapeHtml(ogImage)
  const ogUrl = escapeHtml(uid ? `${origin}/api/share?uid=${encodeURIComponent(uid)}` : `${origin}/api/share`)
  const playerHref = escapeHtml(playerUrl)
  const coverSrcE = escapeHtml(coverSrc)
  const audioSrcE = escapeHtml(audioSrc)
  const intervalE = escapeHtml(interval || '--:--')
  const openAppLabelMobileE = escapeHtml(found ? '打开 App 听更多' : '打开 Holly Music')
  const openAppLabelPcE = escapeHtml(found ? '进入网页版播放器' : '进入网页版')

  // found=true：可点击的播放按钮（<button>，不导航）
  // found=false：纯展示封面（<div disabled>，不可点）
  const coverBlock = found
    ? `<button class="cover-btn" id="coverBtn" type="button" aria-label="播放 ${songNameE}">
<img class="cover" src="${coverSrcE}" alt="${songNameE}">
<span class="cover-overlay"><span class="play-circle" id="playCircle"><svg class="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="icon-pause" viewBox="0 0 24 24" style="display:none"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg><span class="spinner" style="display:none"></span></span></span>
</button>`
    : `<div class="cover-btn disabled">
<img class="cover" src="${coverSrcE}" alt="">
<span class="cover-overlay"><span class="play-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" opacity="0.3"/></svg></span></span>
</div>`

  const infoBlock = found
    ? `<h1 class="title">${songNameE}</h1>
<p class="artist">${artistE}</p>
<p class="meta">${metaE}</p>
<div class="player-controls">
<div class="progress-row">
<span class="time" id="timeCurrent">0:00</span>
<input class="progress" type="range" id="progress" min="0" max="100" value="0" step="0.1" aria-label="播放进度">
<span class="time" id="timeTotal">${intervalE}</span>
</div>
</div>
<p class="error-msg" id="errorMsg" style="display:none"></p>
<p class="hint">点击封面播放</p>`
    : `<h1 class="title">歌曲未找到</h1>
<p class="artist">可能链接已失效</p>
<p class="meta"></p>`

  const audioTag = found
    ? `<audio id="audio" src="${audioSrcE}" preload="metadata" playsinline webkit-playsinline></audio>`
    : ''

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
.cover-btn{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6);margin-bottom:28px;background:#1a1a1a;border:none;padding:0;cursor:pointer;font:inherit;color:inherit}
.cover-btn.disabled{cursor:default}
.cover{width:100%;height:100%;object-fit:cover;display:block}
.cover-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25);transition:background .2s}
.play-circle{width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.18);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;opacity:1;transform:scale(1);transition:opacity .2s,transform .2s,background .2s}
.play-circle svg{display:block;width:28px;height:28px;fill:#fff}
.play-circle .icon-play{margin-left:4px}
.spinner{display:inline-block;width:28px;height:28px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.cover-btn:hover .play-circle,.cover-btn:active .play-circle{background:rgba(255,255,255,.28)}
.cover-btn:hover .cover-overlay,.cover-btn:active .cover-overlay{background:rgba(0,0,0,.45)}
.title{font-size:22px;font-weight:700;line-height:1.35;margin-bottom:8px;word-break:break-word}
.artist{font-size:16px;color:#b3b3b3;margin-bottom:6px}
.meta{font-size:13px;color:#6a6a6a;margin-bottom:24px;min-height:18px}
.player-controls{margin-bottom:20px}
.progress-row{display:flex;align-items:center;gap:10px}
.time{font-size:12px;color:#b3b3b3;font-variant-numeric:tabular-nums;min-width:34px;text-align:center;flex-shrink:0}
.progress{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.15);outline:none;cursor:pointer;background-image:linear-gradient(to right,#1DB954 0%,#1DB954 0%,rgba(255,255,255,.15) 0%,rgba(255,255,255,.15) 100%)}
.progress::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;border:none;box-shadow:0 0 0 0 rgba(29,185,84,.3);transition:box-shadow .2s}
.progress::-webkit-slider-thumb:active{box-shadow:0 0 0 6px rgba(29,185,84,.2)}
.progress::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:none}
.error-msg{font-size:13px;color:#ff6b6b;margin-bottom:16px}
.hint{font-size:14px;color:#1DB954;font-weight:600;letter-spacing:.5px;margin-bottom:24px}
.open-app-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 32px;border-radius:999px;background:#1DB954;color:#000;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:.3px;transition:transform .1s,background .2s;-webkit-tap-highlight-color:transparent}
.open-app-btn:active{transform:scale(.96);background:#1ed760}
.open-app-icon{display:block;width:18px;height:18px;fill:currentColor}
.label-pc{display:none}
.brand{margin-top:40px;font-size:13px;color:#6a6a6a;letter-spacing:.5px}
.brand b{color:#1DB954;font-weight:700}
@media (min-width:768px){
.card{max-width:440px}
.cover-btn{border-radius:20px}
.title{font-size:26px}
.play-circle{width:80px;height:80px}
.play-circle svg{width:32px;height:32px}
.spinner{width:32px;height:32px}
.hint{display:none}
.label-mobile{display:none}
.label-pc{display:inline}
.progress::-webkit-slider-thumb:hover{box-shadow:0 0 0 6px rgba(29,185,84,.2)}
.open-app-btn:hover{background:#1ed760}
}
</style>
</head>
<body>
${audioTag}
<div class="card">
${coverBlock}
${infoBlock}
<a class="open-app-btn" href="${playerHref}">
<svg class="open-app-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
<span class="label-mobile">${openAppLabelMobileE}</span>
<span class="label-pc">${openAppLabelPcE}</span>
</a>
</div>
<div class="brand"><b>♪</b> Holly Music</div>
<script>
(function(){
  var audio = document.getElementById('audio');
  if (!audio) return;
  var coverBtn = document.getElementById('coverBtn');
  var playCircle = document.getElementById('playCircle');
  var iconPlay = playCircle ? playCircle.querySelector('.icon-play') : null;
  var iconPause = playCircle ? playCircle.querySelector('.icon-pause') : null;
  var spinner = playCircle ? playCircle.querySelector('.spinner') : null;
  var progress = document.getElementById('progress');
  var timeCurrent = document.getElementById('timeCurrent');
  var timeTotal = document.getElementById('timeTotal');
  var errorMsg = document.getElementById('errorMsg');
  var isSeeking = false;
  function fmt(t){
    if (!Number.isFinite(t) || t < 0) return '--:--';
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }
  function setIcon(state){
    if (!iconPlay) return;
    iconPlay.style.display = state === 'play' ? 'block' : 'none';
    iconPause.style.display = state === 'pause' ? 'block' : 'none';
    spinner.style.display = state === 'loading' ? 'inline-block' : 'none';
  }
  function updateFill(pct){
    if (!progress) return;
    progress.style.backgroundImage = 'linear-gradient(to right,#1DB954 0%,#1DB954 ' + pct + '%,rgba(255,255,255,.15) ' + pct + '%,rgba(255,255,255,.15) 100%)';
  }
  function showError(msg){
    if (!errorMsg) return;
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
  }
  function hideError(){
    if (errorMsg) errorMsg.style.display = 'none';
  }
  // 关键：play() 必须在 click 同步事件栈内调用，否则丢失用户手势上下文
  function togglePlay(){
    if (audio.paused || audio.ended){
      var p = audio.play();
      if (p && p.catch) p.catch(function(){ setIcon('play'); });
    } else {
      audio.pause();
    }
  }
  if (coverBtn) coverBtn.addEventListener('click', togglePlay);
  audio.addEventListener('loadedmetadata', function(){
    var dur = audio.duration;
    if (Number.isFinite(dur) && dur > 0){
      if (progress) progress.max = String(dur);
      if (timeTotal) timeTotal.textContent = fmt(dur);
    }
  });
  audio.addEventListener('timeupdate', function(){
    if (isSeeking) return;
    var cur = audio.currentTime, dur = audio.duration;
    if (Number.isFinite(cur) && timeCurrent) timeCurrent.textContent = fmt(cur);
    if (Number.isFinite(dur) && dur > 0 && progress){
      progress.value = String(cur);
      updateFill((cur / dur) * 100);
    }
  });
  audio.addEventListener('play', function(){ setIcon('pause'); hideError(); });
  audio.addEventListener('pause', function(){ setIcon('play'); });
  audio.addEventListener('waiting', function(){ setIcon('loading'); });
  audio.addEventListener('canplay', function(){ setIcon(audio.paused ? 'play' : 'pause'); });
  audio.addEventListener('ended', function(){
    setIcon('play');
    if (progress) progress.value = '0';
    updateFill(0);
    if (timeCurrent) timeCurrent.textContent = '0:00';
  });
  audio.addEventListener('error', function(){
    setIcon('play');
    var err = audio.error, msg = '音频加载失败';
    if (err){
      if (err.code === 2) msg = '网络错误，请检查网络后重试';
      else if (err.code === 3) msg = '音频解码失败';
      else if (err.code === 4) msg = '音频源无效或已失效';
    }
    showError(msg);
  });
  // 进度条：拖动中只更新视觉（input），释放才 seek（change），避免频繁 Range 请求
  if (progress){
    progress.addEventListener('input', function(){
      isSeeking = true;
      var val = parseFloat(progress.value), dur = audio.duration;
      if (timeCurrent) timeCurrent.textContent = fmt(val);
      if (Number.isFinite(dur) && dur > 0) updateFill((val / dur) * 100);
    });
    progress.addEventListener('change', function(){
      try { audio.currentTime = parseFloat(progress.value); } catch(e){}
      isSeeking = false;
    });
  }
  // PC 键盘：空格播放/暂停（button 聚焦时让其自身处理），M 静音
  document.addEventListener('keydown', function(e){
    if (e.code === 'Space' || e.key === ' '){
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'BUTTON') return;
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'm' || e.key === 'M'){
      audio.muted = !audio.muted;
    }
  });
  // 自动播放：微信走 WeixinJSBridge 借手势；其他环境 try play（PC 桌面 MEI 放行时成功）
  function tryAutoplay(){
    var p = audio.play();
    if (p && p.catch) p.catch(function(){});
  }
  function weixinPlay(){
    if (typeof window.WeixinJSBridge === 'undefined') return;
    try { WeixinJSBridge.invoke('getNetworkType', {}, function(){ tryAutoplay(); }); } catch(e){}
  }
  if (/MicroMessenger/i.test(navigator.userAgent)){
    if (typeof window.WeixinJSBridge !== 'undefined') weixinPlay();
    else document.addEventListener('WeixinJSBridgeReady', function(){ weixinPlay(); }, false);
  } else {
    tryAutoplay();
  }
})();
</script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
