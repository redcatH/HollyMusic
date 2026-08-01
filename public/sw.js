/**
 * Holly Music Service Worker
 *
 * 策略：
 * - 安装时预缓存 app shell（manifest、图标）
 * - 静态资源（_next/static、图标、manifest）：cache-first，命中后异步更新
 * - 音频代理 /api/proxy、API 数据 /api/*：network-only（不缓存，避免脏数据/版权问题）
 * - RSC payload（?_rsc=xxx）：network-only，绝不缓存（_rsc 每次不同，缓存会无限膨胀）
 * - 页面导航（HTML）：network-first，失败回退到缓存的 app shell（离线可打开壳）
 * - 白名单内同源 GET 才处理；跨域、非 GET 直接透传
 */

const VERSION = 'v3'
const STATIC_CACHE = `holly-static-${VERSION}`
const PAGE_CACHE = `holly-pages-${VERSION}`

// 预缓存清单（app shell 最小集）
const PRECACHE = [
  '/',
  '/manifest.json',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      // 预缓存失败不阻塞安装（个别资源 404 不影响）
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理旧版本缓存
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // 只处理同源 GET；POST/PUT/DELETE、跨域一律透传
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 音频代理与动态 API：network-only
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // RSC payload（?_rsc=xxx）：network-only，绝不缓存
  // _rsc 的值每次导航不同，缓存会导致 STATIC_CACHE 无限膨胀且永远命中不了；
  // 失败时返回错误响应，让 Next.js router 自行降级为硬导航（PR #46674）
  if (url.searchParams.has('_rsc')) {
    event.respondWith(fetch(request).catch(() => Response.error()))
    return
  }

  // HTML 页面导航：network-first，离线时回退 app shell
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // 其余静态资源：stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request))
})

async function networkFirst(request) {
  try {
    const res = await fetch(request)
    // 只缓存成功响应（2xx），避免缓存 4xx/5xx 错误页导致后续持续返回错误
    if (res.ok) {
      const cache = await caches.open(PAGE_CACHE)
      cache.put(request, res.clone())
    }
    return res
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // 最终回退到缓存的 app shell（PRECACHE 里的 '/'）
    const shell = await caches.match('/')
    if (shell) return shell
    throw new Error('offline and no cache')
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request)
    .then((res) => {
      // 只缓存成功的同类型响应
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(request, res.clone())
      }
      return res
    })
    .catch(() => null)
  // 命中缓存立即返回，同时后台更新；未命中则等网络
  return cached || (await fetchPromise) || Response.error()
}
