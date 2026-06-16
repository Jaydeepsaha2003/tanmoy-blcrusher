import { AsyncLocalStorage } from 'node:async_hooks'
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import {
  createSqliteAdapter,
  createMysqlAdapter,
  type Adapter,
  type DbKind,
  type RunResult
} from './adapters'
import { runMigrations } from './migrations'

// MySQL when DB_HOST/DB_NAME (or DB_CLIENT=mysql) is set — i.e. on the server.
// Otherwise SQLite (local dev / desktop / tests).
const KIND: DbKind =
  process.env.DB_HOST || process.env.DB_NAME || process.env.DB_CLIENT === 'mysql' ? 'mysql' : 'sqlite'

let adapter: Adapter | null = null
let initPromise: Promise<void> | null = null
// Holds the active transaction connection for the current async call chain.
const txStore = new AsyncLocalStorage<unknown>()

function sqliteFile(): string {
  const dir = process.env.BL_DB_DIR || app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'blcrusher.db')
}

async function doInit(): Promise<void> {
  adapter = KIND === 'mysql' ? createMysqlAdapter() : createSqliteAdapter(sqliteFile())
  await adapter.init()
  await runMigrations(adapter, KIND)
}

function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = doInit()
  return initPromise
}

/** Initialise the database (connect + migrate + seed). Call once at boot. */
export function initDb(): Promise<void> {
  return ensureInit()
}

export function dbKind(): DbKind {
  return KIND
}

async function exec(sql: string, params?: unknown): ReturnType<Adapter['exec']> {
  await ensureInit()
  const conn = txStore.getStore() ?? null
  return adapter!.exec(sql, params, conn)
}

export interface PreparedStatement {
  get<T = any>(...params: any[]): Promise<T | undefined>
  all<T = any>(...params: any[]): Promise<T[]>
  run(...params: any[]): Promise<RunResult>
}

export interface Db {
  get<T = any>(sql: string, params?: unknown): Promise<T | undefined>
  all<T = any>(sql: string, params?: unknown): Promise<T[]>
  run(sql: string, params?: unknown): Promise<RunResult>
  prepare(sql: string): PreparedStatement
  transaction<T>(fn: () => Promise<T>): Promise<T>
}

// Mirror better-sqlite3 binding: a single object arg => named params, anything
// else => positional. So `.get(id)`, `.get({a,b})`, `.run(x, y)`, `.all()` all work.
function normalizeArgs(args: any[]): unknown {
  if (args.length === 0) return undefined
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0]
  }
  return args
}

const wrapper: Db = {
  async get(sql, params) {
    return (await exec(sql, params)).rows[0]
  },
  async all(sql, params) {
    return (await exec(sql, params)).rows
  },
  async run(sql, params) {
    return (await exec(sql, params)).runResult
  },
  prepare(sql) {
    return {
      get: (...p: any[]) => wrapper.get(sql, normalizeArgs(p)),
      all: (...p: any[]) => wrapper.all(sql, normalizeArgs(p)),
      run: (...p: any[]) => wrapper.run(sql, normalizeArgs(p))
    }
  },
  async transaction(fn) {
    await ensureInit()
    if (txStore.getStore()) return fn() // already inside a transaction — join it
    const conn = await adapter!.beginTx()
    try {
      const result = await txStore.run(conn, fn)
      await adapter!.commitTx(conn)
      return result
    } catch (e) {
      try {
        await adapter!.rollbackTx(conn)
      } catch {
        /* ignore rollback failure */
      }
      throw e
    } finally {
      adapter!.releaseTx(conn)
    }
  }
}

export function getDb(): Db {
  return wrapper
}

/** Atomically increment a counter and return a formatted number, e.g. PUR-000001 */
export async function nextNumber(prefix: string, counter: string): Promise<string> {
  const d = getDb()
  const upsert =
    KIND === 'mysql'
      ? `INSERT INTO counters (name, current) VALUES (?, 0) ON DUPLICATE KEY UPDATE current = current`
      : `INSERT INTO counters (name, current) VALUES (?, 0) ON CONFLICT(name) DO NOTHING`
  return d.transaction(async () => {
    await d.run(upsert, [counter])
    await d.run(`UPDATE counters SET current = current + 1 WHERE name = ?`, [counter])
    const row = (await d.get(`SELECT current FROM counters WHERE name = ?`, [counter])) as {
      current: number
    }
    return `${prefix}-${String(row.current).padStart(6, '0')}`
  })
}
