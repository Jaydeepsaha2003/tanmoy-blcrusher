import * as React from 'react'
import { useLocation } from 'react-router-dom'

// In-memory fallback when sessionStorage is unavailable (private mode, etc.).
const mem = new Map<string, string>()

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return mem.get(key) ?? null
  }
}
function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    mem.set(key, value)
  }
}

/**
 * Like React.useState, but the value survives a page reload. Keyed by the
 * current route path + a field name, so each page keeps its own tab/filter
 * selection. Backed by sessionStorage (cleared when the tab is closed), so a
 * fresh visit starts from the default while a reload restores where you were.
 *
 * Drop-in replacement: `usePersistentState('tab', 'purchases')`.
 */
export function usePersistentState<T>(
  field: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { pathname } = useLocation()
  const key = `bl.ui:${pathname}:${field}`
  const [value, setValue] = React.useState<T>(() => {
    const raw = read(key)
    if (raw == null) return initial
    try {
      return JSON.parse(raw) as T
    } catch {
      return initial
    }
  })
  React.useEffect(() => {
    write(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue]
}
