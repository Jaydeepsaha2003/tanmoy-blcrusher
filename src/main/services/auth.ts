import type { User } from '@shared/types'
import { authenticate, changeOwnPassword } from './users'

/**
 * Validate credentials. Both transports normally call users.authenticate()
 * directly (to also create a session); this remains for completeness/back-compat.
 */
export function login(payload: { username?: string; password: string }): {
  ok: boolean
  user?: User
} {
  const user = authenticate(payload.username || 'admin', payload.password)
  return user ? { ok: true, user } : { ok: false }
}

/** Change the signed-in user's own password (uses the current-user context). */
export function changePassword(payload: { current: string; next: string }): {
  ok: boolean
  error?: string
} {
  return changeOwnPassword(payload)
}
