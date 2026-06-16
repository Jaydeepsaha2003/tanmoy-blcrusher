import { getDb } from '../db'
import { hashPassword, verifyPassword } from '../crypto'
import { getCurrentUser } from '../context'
import type { User, Role, AccessLevel, ModuleKey } from '@shared/types'
import { properCase } from '@shared/types'
import { STAFF_MODULES } from '@shared/permissions'

interface UserRow {
  id: number
  username: string
  name: string
  password_hash: string
  role: Role
  access_level: AccessLevel
  modules: string
  active: number
  created_at: string
}

const VALID_MODULES = new Set(STAFF_MODULES.map((m) => m.key))

function toUser(row: UserRow): User {
  let modules: ModuleKey[] = []
  try {
    modules = JSON.parse(row.modules || '[]')
  } catch {
    modules = []
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    access_level: row.access_level,
    modules,
    active: row.active,
    created_at: row.created_at
  }
}

function sanitizeModules(role: Role, modules: unknown): ModuleKey[] {
  if (role === 'admin') return [] // admin implies every module
  if (!Array.isArray(modules)) return []
  return modules.filter((m): m is ModuleKey => typeof m === 'string' && VALID_MODULES.has(m as ModuleKey))
}

function activeAdminCount(excludeId?: number): number {
  const d = getDb()
  const row = d
    .prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?`
    )
    .get(excludeId ?? -1) as { n: number }
  return row.n
}

export function listUsers(): User[] {
  const d = getDb()
  const rows = d
    .prepare(`SELECT * FROM users ORDER BY (role = 'admin') DESC, username ASC`)
    .all() as UserRow[]
  return rows.map(toUser)
}

export function getUserById(id: number): User | null {
  const d = getDb()
  const row = d.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(id) as
    | UserRow
    | undefined
  return row ? toUser(row) : null
}

export function authenticate(username: string, password: string): User | null {
  const d = getDb()
  const uname = (username || '').trim().toLowerCase()
  if (!uname) return null
  const row = d
    .prepare(`SELECT * FROM users WHERE username = ? AND active = 1`)
    .get(uname) as UserRow | undefined
  if (!row || !verifyPassword(password, row.password_hash)) return null
  return toUser(row)
}

export interface UserInput {
  id?: number
  username: string
  name: string
  password?: string
  role: Role
  access_level: AccessLevel
  modules: ModuleKey[]
  active?: boolean | number
}

export function createUser(p: UserInput): User {
  const d = getDb()
  const username = (p.username || '').trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,}$/.test(username)) {
    throw new Error('Username must be at least 3 characters (letters, numbers, . _ - only).')
  }
  if (!p.password || p.password.length < 4) {
    throw new Error('Password must be at least 4 characters.')
  }
  const exists = d.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
  if (exists) throw new Error('That username is already taken.')

  const role: Role = p.role === 'admin' ? 'admin' : 'staff'
  const accessLevel: AccessLevel = role === 'admin' ? 'edit' : p.access_level === 'edit' ? 'edit' : 'view'
  const info = d
    .prepare(
      `INSERT INTO users (username, name, password_hash, role, access_level, modules, active)
       VALUES (@username,@name,@password_hash,@role,@access_level,@modules,@active)`
    )
    .run({
      username,
      name: properCase(p.name) || username,
      password_hash: hashPassword(p.password),
      role,
      access_level: accessLevel,
      modules: JSON.stringify(sanitizeModules(role, p.modules)),
      active: p.active === false ? 0 : 1
    })
  return toUser(d.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(info.lastInsertRowid)) as UserRow)
}

export function updateUser(p: UserInput): User {
  const d = getDb()
  if (!p.id) throw new Error('Missing user id.')
  const old = d.prepare(`SELECT * FROM users WHERE id = ?`).get(p.id) as UserRow | undefined
  if (!old) throw new Error('User not found.')

  const username = (p.username || '').trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,}$/.test(username)) {
    throw new Error('Username must be at least 3 characters (letters, numbers, . _ - only).')
  }
  const clash = d.prepare(`SELECT id FROM users WHERE username = ? AND id <> ?`).get(username, p.id)
  if (clash) throw new Error('That username is already taken.')

  const role: Role = p.role === 'admin' ? 'admin' : 'staff'
  const active = p.active === false ? 0 : 1
  // Don't let the last admin be demoted or deactivated (would lock everyone out).
  const wasActiveAdmin = old.role === 'admin' && old.active === 1
  const stillActiveAdmin = role === 'admin' && active === 1
  if (wasActiveAdmin && !stillActiveAdmin && activeAdminCount(p.id) === 0) {
    throw new Error('This is the last active admin — keep at least one admin account.')
  }

  const accessLevel: AccessLevel = role === 'admin' ? 'edit' : p.access_level === 'edit' ? 'edit' : 'view'
  const passwordHash = p.password && p.password.length > 0 ? hashPassword(p.password) : old.password_hash
  if (p.password && p.password.length > 0 && p.password.length < 4) {
    throw new Error('Password must be at least 4 characters.')
  }
  d.prepare(
    `UPDATE users SET username=@username, name=@name, password_hash=@password_hash,
       role=@role, access_level=@access_level, modules=@modules, active=@active WHERE id=@id`
  ).run({
    id: p.id,
    username,
    name: properCase(p.name) || username,
    password_hash: passwordHash,
    role,
    access_level: accessLevel,
    modules: JSON.stringify(sanitizeModules(role, p.modules)),
    active
  })
  return toUser(d.prepare(`SELECT * FROM users WHERE id = ?`).get(p.id) as UserRow)
}

export function deleteUser(payload: { id: number }): { ok: boolean; error?: string } {
  const d = getDb()
  const me = getCurrentUser()
  if (me && me.id === payload.id) return { ok: false, error: 'You cannot delete your own account.' }
  const row = d.prepare(`SELECT * FROM users WHERE id = ?`).get(payload.id) as UserRow | undefined
  if (!row) return { ok: false, error: 'User not found.' }
  if (row.role === 'admin' && row.active === 1 && activeAdminCount(payload.id) === 0) {
    return { ok: false, error: 'This is the last active admin — cannot delete it.' }
  }
  d.prepare(`DELETE FROM users WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/** Change the currently logged-in user's own password. */
export function changeOwnPassword(payload: { current: string; next: string }): {
  ok: boolean
  error?: string
} {
  const d = getDb()
  const me = getCurrentUser()
  if (!me) return { ok: false, error: 'Not signed in.' }
  const row = d.prepare(`SELECT * FROM users WHERE id = ?`).get(me.id) as UserRow | undefined
  if (!row || !verifyPassword(payload.current, row.password_hash)) {
    return { ok: false, error: 'Current password is incorrect.' }
  }
  if (!payload.next || payload.next.length < 4) {
    return { ok: false, error: 'New password must be at least 4 characters.' }
  }
  d.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(payload.next), me.id)
  return { ok: true }
}
