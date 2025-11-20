'use client'

import { MainLayout } from '@/components/layout/MainLayout'

export default function Home() {
  return (
    <MainLayout>
      <div className="p-4 lg:p-8">
        <h2 className="text-2xl font-bold mb-6">欢迎来到 LX Music</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg bg-gray-100 dark:bg-gray-900 p-4 h-48 flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="text-center">
                <div className="text-4xl mb-2">♪</div>
                <p className="text-sm text-gray-600 dark:text-gray-400">播放列表 {i + 1}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MainLayout>
  )
}
