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

/**
 * Plant ids the current user is limited to. Empty array = unrestricted (admin or a
 * staff user with no plant restriction) — callers treat empty as "all plants".
 * Aggregate/cross-plant reads use this to stay within the user's plants even when
 * no explicit plant_id is supplied.
 */
export function currentPlantScope(): number[] {
  const u = getCurrentUser()
  return u && u.role !== 'admin' && Array.isArray(u.plant_ids) ? u.plant_ids : []
}
