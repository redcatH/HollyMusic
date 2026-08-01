/**
 * next/navigation → react-router-dom shim
 *
 * Vite alias 将 'next/navigation' 解析到本文件，
 * 使现有组件 `import { useRouter, usePathname, useSearchParams } from 'next/navigation'` 零修改可用。
 *
 * useRouter() 返回兼容 Next.js 的接口：push/replace/back/forward。
 */

import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'

export function useRouter() {
  const navigate = useNavigate()
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: () => { /* no-op: react-router 无 prefetch 概念 */ },
  }
}

export function usePathname(): string {
  return useLocation().pathname
}

export { useSearchParams }
