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
        // changeOrigin: false 保留原始 Host（localhost:5173），让 /api/share 构造的跳转 URL 指回前端 SPA，而非 next 端口
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // 静态资源在 nginx 下直接 serve
    base: '/',
  },
  // 静态资源目录指向仓库根的 public/（PWA 资源：manifest.json / icon.svg / sw.js / icons/）。
  // 不能用默认的 frontend/public——那只是本地一个未跟踪的 symlink，git pull 后不存在，
  // 会导致 Docker 构建时 COPY frontend/public 失败。统一用根 public/ 作为唯一来源。
  publicDir: path.resolve(__dirname, '..', 'public'),
})
