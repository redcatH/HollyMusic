
import { useToastStore } from '@/lib/toast'
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react'

export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts)
  const removeToast = useToastStore((state) => state.removeToast)

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" />
      case 'error':
        return <AlertCircle className="w-5 h-5" />
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />
      case 'info':
      default:
        return <Info className="w-5 h-5" />
    }
  }

  const getStyles = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 text-green-900 border-green-200'
      case 'error':
        return 'bg-red-50 text-red-900 border-red-200'
      case 'warning':
        return 'bg-yellow-50 text-yellow-900 border-yellow-200'
      case 'info':
      default:
        return 'bg-blue-50 text-blue-900 border-blue-200'
    }
  }

  const getIconColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      case 'warning':
        return 'text-yellow-500'
      case 'info':
      default:
        return 'text-blue-500'
    }
  }

  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg animate-in slide-in-from-right-full duration-300 ${getStyles(
            t.type
          )}`}
        >
          <div className={getIconColor(t.type)}>{getIcon(t.type)}</div>
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button
            onClick={() => removeToast(t.id)}
            className="hover:opacity-70 transition-opacity"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
