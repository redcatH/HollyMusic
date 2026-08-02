import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 前端通过 @ 复用根目录的 components/hooks/lib（纯前端部分）
      '@': path.resolve(__dirname, '..'),
      '@@': path.resolve(__dirname, 'src'),
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
