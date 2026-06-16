import * as React from 'react'
import { Modal, Button } from './ui'

interface ConfirmState {
  title: string
  message: string
  confirmText?: string
  resolve: (ok: boolean) => void
}

let externalConfirm: ((opts: Omit<ConfirmState, 'resolve'>) => Promise<boolean>) | null = null

export function confirmDialog(opts: Omit<ConfirmState, 'resolve'>): Promise<boolean> {
  if (!externalConfirm) return Promise.resolve(window.confirm(opts.message))
  return externalConfirm(opts)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = React.useState<ConfirmState | null>(null)
  externalConfirm = (opts) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }))

  const close = (ok: boolean): void => {
    state?.resolve(ok)
    setState(null)
  }

  return (
    <>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title || ''} width="max-w-md">
        <p className="text-sm text-muted-foreground">{state?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => close(true)}>
            {state?.confirmText || 'Delete'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
