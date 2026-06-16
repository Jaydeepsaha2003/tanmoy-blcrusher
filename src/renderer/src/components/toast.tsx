import * as React from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastCtx {
  push: (kind: ToastKind, message: string) => void
}
const Ctx = React.createContext<ToastCtx | null>(null)

export function useToast(): {
  success: (m: string) => void
  error: (m: string) => void
  info: (m: string) => void
} {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return {
    success: (m) => ctx.push('success', m),
    error: (m) => ctx.push('error', m),
    info: (m) => ctx.push('info', m)
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const push = React.useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  const remove = (id: number): void => setToasts((t) => t.filter((x) => x.id !== id))

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-start gap-3 rounded-lg border bg-card p-3 shadow-lg',
              t.kind === 'success' && 'border-success/30',
              t.kind === 'error' && 'border-destructive/30',
              t.kind === 'info' && 'border-primary/30'
            )}
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={18} />}
            {t.kind === 'error' && <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />}
            {t.kind === 'info' && <Info className="mt-0.5 shrink-0 text-primary" size={18} />}
            <p className="flex-1 text-sm leading-snug">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-muted-foreground hover:text-foreground">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
