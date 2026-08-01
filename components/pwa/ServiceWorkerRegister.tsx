'use client'

/**
 * Service Worker 注册。
 *
 * 仅在生产环境注册（dev 下 SW 缓存会干扰热更新）。
 * 注册成功后 SW 接管 app shell 离线缓存，PWA 才能被正确安装。
 */

import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(err => {
          // 注册失败不阻塞应用，仅记录
          console.warn('[SW] 注册失败:', err)
        })
    }

    // 页面加载完成后注册，避免抢占首屏资源
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
