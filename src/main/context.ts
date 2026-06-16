import { AsyncLocalStorage } from 'node:async_hooks'
import type { User } from '@shared/types'

// The user behind the current API call, scoped per async call chain so concurrent
// web requests never see each other's user (a module-global would race once the
// data layer is asynchronous).
const store = new AsyncLocalStorage<User | null>()

/** Run `fn` with `user` as the current user for the duration of the async chain. */
export function runWithUser<T>(user: User | null, fn: () => Promise<T>): Promise<T> {
  return store.run(user, fn)
}

export function getCurrentUser(): User | null {
  return store.getStore() ?? null
}
