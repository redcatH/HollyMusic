"use client"
import Script from 'next/script'

export default function VConsoleScript() {
  return (
    <Script
      src="https://unpkg.com/vconsole@3.7.0/dist/vconsole.min.js"
      strategy="afterInteractive"
      onLoad={() => {
        try {
          const enabledByEnv = process.env.NEXT_PUBLIC_ENABLE_VCONSOLE === 'true'
          const enabledByQuery = typeof window !== 'undefined' && window.location.search.includes('vconsole=1')
          if (!enabledByEnv && !enabledByQuery) return
          const ctor = (globalThis as unknown as { VConsole?: unknown }).VConsole as unknown as { new(...args: unknown[]): unknown }
          if (typeof ctor === 'function') {
            new ctor()
            console.info('[vConsole] initialized')
          }
        } catch {
          // ignore
        }
      }}
    />
  )
}
