'use client'

import { useEffect } from 'react'

/**
 * 客户端入口：注册 Service Worker。
 * 仅生产环境注册（dev 下 SW 缓存会干扰调试）。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => {
        // 注册失败不影响主功能
        console.warn('[sw] register failed', e)
      })
    }

    // 页面 load 后注册，避免抢占首屏资源
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
