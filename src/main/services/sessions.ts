import { randomBytes } from 'node:crypto'
import { getDb } from '../db'

// 30-day sliding session lifetime.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function createSession(userId: number): Promise<string> {
  const d = getDb()
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  await d.prepare(
    `INSERT INTO sessions (token, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)`
  ).run(token, now, now + SESSION_TTL_MS, userId)
  return token
}

/** Returns the session's user id if live (sliding the expiry), else null. */
export async function sessionUserId(token: string | undefined): Promise<number | null> {
  if (!token) return null
  const d = getDb()
  const row = await d.prepare(`SELECT expires_at, user_id FROM sessions WHERE token = ?`).get(token) as
    | { expires_at: number; user_id: number | null }
    | undefined
  const now = Date.now()
  if (!row || row.expires_at < now || row.user_id == null) return null
  await d.prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`).run(now + SESSION_TTL_MS, token)
  return row.user_id
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return
  await getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
}

/** Remove expired sessions; call occasionally to keep the table tidy. */
export async function cleanupSessions(): Promise<void> {
  await getDb().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now())
}
