// Low-level database adapters behind one async interface.
//  - sqlite  : better-sqlite3 (local dev / desktop / tests) — synchronous, wrapped in async
//  - mysql   : mysql2/promise (production, e.g. Hostinger)
// Both are loaded lazily so only the one in use needs to be installed at runtime.

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface ExecResult {
  rows: any[]
  runResult: RunResult
}

export type DbKind = 'sqlite' | 'mysql'

export interface Adapter {
  kind: DbKind
  init(): Promise<void>
  /** Run a single statement. `conn` is a transaction handle, or null for the pool/default. */
  exec(sql: string, params: unknown, conn: unknown | null): Promise<ExecResult>
  /** Run a multi-statement script (DDL). */
  execRaw(sql: string): Promise<void>
  beginTx(): Promise<unknown>
  commitTx(conn: unknown): Promise<void>
  rollbackTx(conn: unknown): Promise<void>
  releaseTx(conn: unknown): void
}

function isNamed(params: unknown): params is Record<string, unknown> {
  return !!params && typeof params === 'object' && !Array.isArray(params)
}

function isSelect(sql: string): boolean {
  return /^\s*(select|pragma|with|show|explain|describe)/i.test(sql)
}

// ---------------------------------------------------------------------------
// SQLite (better-sqlite3)
// ---------------------------------------------------------------------------
export function createSqliteAdapter(dbFile: string): Adapter {
  let db: any = null
  return {
    kind: 'sqlite',
    async init(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3')
      db = new Database(dbFile)
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
    },
    async exec(sql, params): Promise<ExecResult> {
      const stmt = db.prepare(sql)
      if (isSelect(sql)) {
        const rows = isNamed(params)
          ? stmt.all(params)
          : params == null
            ? stmt.all()
            : stmt.all(...(params as unknown[]))
        return { rows, runResult: { changes: 0, lastInsertRowid: 0 } }
      }
      const info = isNamed(params)
        ? stmt.run(params)
        : params == null
          ? stmt.run()
          : stmt.run(...(params as unknown[]))
      return { rows: [], runResult: { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) } }
    },
    async execRaw(sql): Promise<void> {
      db.exec(sql)
    },
    // better-sqlite3 is synchronous and single-connection; one DB-wide tx is fine.
    async beginTx(): Promise<unknown> {
      db.exec('BEGIN')
      return db
    },
    async commitTx(): Promise<void> {
      db.exec('COMMIT')
    },
    async rollbackTx(): Promise<void> {
      db.exec('ROLLBACK')
    },
    releaseTx(): void {
      /* nothing to release for sqlite */
    }
  }
}

// ---------------------------------------------------------------------------
// MySQL (mysql2/promise)
// ---------------------------------------------------------------------------
// better-sqlite3 uses @name placeholders; mysql2 named placeholders use :name.
function toNamed(sql: string): string {
  return sql.replace(/@(\w+)/g, ':$1')
}

export function createMysqlAdapter(): Adapter {
  let pool: any = null
  return {
    kind: 'mysql',
    async init(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mysql = require('mysql2/promise')
      pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: Number(process.env.DB_POOL) || 5,
        namedPlaceholders: true,
        dateStrings: true
      })
    },
    async exec(sql, params, conn): Promise<ExecResult> {
      const runner: any = conn ?? pool
      let res: any
      if (isNamed(params)) {
        res = await runner.query({ sql: toNamed(sql), namedPlaceholders: true, values: params })
      } else if (Array.isArray(params)) {
        res = await runner.query(sql, params)
      } else {
        res = await runner.query(sql)
      }
      const rows = res[0]
      if (Array.isArray(rows)) {
        return { rows, runResult: { changes: 0, lastInsertRowid: 0 } }
      }
      return {
        rows: [],
        runResult: {
          changes: Number(rows?.affectedRows ?? 0),
          lastInsertRowid: Number(rows?.insertId ?? 0)
        }
      }
    },
    async execRaw(sql): Promise<void> {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^--/.test(s))
      for (const stmt of statements) {
        await pool.query(stmt)
      }
    },
    async beginTx(): Promise<unknown> {
      const c = await pool.getConnection()
      await c.beginTransaction()
      return c
    },
    async commitTx(conn): Promise<void> {
      await (conn as any).commit()
    },
    async rollbackTx(conn): Promise<void> {
      await (conn as any).rollback()
    },
    releaseTx(conn): void {
      ;(conn as any).release()
    }
  }
}
