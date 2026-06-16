import type { User } from '@shared/types'

// The user behind the current API call. Both transports set this immediately
// before invoking a handler and clear it afterwards. This is safe because every
// handler runs synchronously to completion (better-sqlite3 is synchronous and
// Node is single-threaded), so calls never interleave.
let current: User | null = null

export function setCurrentUser(user: User | null): void {
  current = user
}

export function getCurrentUser(): User | null {
  return current
}
