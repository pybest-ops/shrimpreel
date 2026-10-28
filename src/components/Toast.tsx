import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

// 轻提示（类似 element-ui 的 this.$message.warning）：任何地方调 toast.warning(text)，
// 根布局里的 <Toaster /> 收到事件后在页面顶部居中显示，3 秒后自动消失
type Kind = 'warning' | 'error'
type Item = { id: number; kind: Kind; text: string }

const TOAST_EVENT = 'site-toast'
const DURATION_MS = 3000

function emit(kind: Kind, text: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<Omit<Item, 'id'>>(TOAST_EVENT, { detail: { kind, text } }))
}

export const toast = {
  warning: (text: string) => emit('warning', text),
  error: (text: string) => emit('error', text),
}

export function Toaster() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let nextId = 1
    const onToast = (event: Event) => {
      const { kind, text } = (event as CustomEvent<Omit<Item, 'id'>>).detail
      const id = nextId++
      // 同一条文案连续触发只保留最新一条，计时重新开始
      setItems((current) => [...current.filter((item) => item.text !== text), { id, kind, text }])
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), DURATION_MS)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          data-testid="toast"
          className={`flex max-w-sm items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ring-1 ${
            item.kind === 'error'
              ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900'
              : 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900'
          }`}
        >
          {item.kind === 'error' ? <CircleAlert className="size-4 shrink-0" /> : <TriangleAlert className="size-4 shrink-0" />}
          {item.text}
        </div>
      ))}
    </div>
  )
}
