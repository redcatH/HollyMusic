'use client'

import { useState } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { HistoryList } from '@/components/history/HistoryList'
import { Clock, Trash2, BarChart3 } from 'lucide-react'
import { usePlayHistory } from '@/hooks/usePlayHistory'

export default function HistoryPage() {
  const { clearHistory, count } = usePlayHistory()
  const [sortBy, setSortBy] = useState<'time' | 'count'>('time')
  
  const handleClearAll = async () => {
    if (confirm('确定要清空所有播放记录吗？')) {
      await clearHistory()
    }
  }
  
  return (
    <MainLayout>
      <div className="p-4 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Clock className="h-6 w-6 text-purple-500" />
              <h1 className="text-2xl font-bold">历史播放</h1>
              {count > 0 && (
                <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-full">
                  {count} 首歌曲
                </span>
              )}
            </div>
            {count > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSortBy('time')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    sortBy === 'time'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  <Clock className="h-4 w-4" />
                  最近播放
                </button>
                <button
                  onClick={() => setSortBy('count')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    sortBy === 'count'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  <BarChart3 className="h-4 w-4" />
                  播放次数
                </button>
                <button
                  onClick={handleClearAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  清空
                </button>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
            <HistoryList sortBy={sortBy} />
          </div>

          {count === 0 && (
            <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
              <Clock className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <p className="text-lg font-medium">暂无播放记录</p>
              <p className="text-sm mt-2">播放过的歌曲会自动保存到这里</p>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  )
}
