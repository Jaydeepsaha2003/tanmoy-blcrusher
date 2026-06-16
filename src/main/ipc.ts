import { ipcMain } from 'electron'
import { handlers } from './handlers'
import { authenticate } from './services/users'
import { setCurrentUser } from './context'
import { logActivity } from './services/audit'
import { can, isWriteMethod, SELF_METHODS } from '@shared/permissions'
import type { User } from '@shared/types'

// The desktop app is single-window, so one in-memory current user is enough.
let desktopUser: User | null = null

function failed(result: unknown): boolean {
  return (
    !!result && typeof result === 'object' && 'ok' in result && (result as { ok: unknown }).ok === false
  )
}

export function registerIpc(): void {
  ipcMain.handle('api', (_e, method: string, payload: any) => {
    // --- Auth methods manage the in-memory desktop session ---
    if (method === 'auth.login') {
      const user = authenticate(payload?.username || 'admin', payload?.password || '')
      desktopUser = user
      if (user) logActivity({ method: 'auth.login', user })
      return user ? { ok: true, user } : { ok: false }
    }
    if (method === 'auth.me') return { ok: !!desktopUser, user: desktopUser }
    if (method === 'auth.logout') {
      if (desktopUser) logActivity({ method: 'auth.logout', user: desktopUser })
      desktopUser = null
      return { ok: true }
    }

    const fn = handlers[method]
    if (!fn) throw new Error(`Unknown API method: ${method}`)
    if (!desktopUser) throw new Error('Not signed in.')
    if (!can(desktopUser, method)) throw new Error('You do not have permission to do that.')

    setCurrentUser(desktopUser)
    try {
      const result = fn(payload)
      if ((isWriteMethod(method) || SELF_METHODS.has(method)) && !failed(result)) {
        logActivity({ method, payload })
      }
      return result
    } catch (err) {
      throw new Error((err as Error).message || 'Operation failed')
    } finally {
      setCurrentUser(null)
    }
  })
}
