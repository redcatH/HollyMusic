import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
      '@@': path.resolve(__dirname, 'src'),
      // Next.js → react-router shims（让现有组件零修改可用）
      'next/link': path.resolve(__dirname, 'src/shims/next-link.ts'),
      'next/navigation': path.resolve(__dirname, 'src/shims/next-navigation.ts'),
    },
  },
  server: {
    port: 5173,
    // 开发时代理 /api 到 Next.js dev server (端口 3000)
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // 静态资源在 nginx 下直接 serve
    base: '/',
  },
})
