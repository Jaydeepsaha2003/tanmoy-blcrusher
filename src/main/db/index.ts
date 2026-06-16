import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { SCHEMA } from './schema'
import { hashPassword } from '../crypto'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  // BL_DB_DIR lets the web server choose the data directory (e.g. a mounted
  // persistent disk). In the Electron desktop build it is unset, so we fall
  // back to the per-user app data folder exactly as before.
  const dir = process.env.BL_DB_DIR || app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, 'blcrusher.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  seedDefaults(db)
  return db
}

/** Add columns introduced after the first release to existing databases. */
function migrate(d: Database.Database): void {
  const addColumn = (table: string, col: string, def: string): void => {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === col)) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
    }
  }

  // Masters can be common (NULL) or tied to a single plant.
  for (const table of ['suppliers', 'customers', 'transporters']) {
    addColumn(table, 'company_id', 'INTEGER')
    addColumn(table, 'plant_id', 'INTEGER')
  }

  // Direct Sale fields added to dispatches.
  addColumn('dispatches', 'uom', `TEXT NOT NULL DEFAULT 'CM'`)
  addColumn('dispatches', 'qty_cm', 'REAL NOT NULL DEFAULT 0')
  addColumn('dispatches', 'transport_charge', 'REAL NOT NULL DEFAULT 0')
  addColumn('dispatches', 'transport_billed', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('dispatches', 'other_charge', 'REAL NOT NULL DEFAULT 0')
  addColumn('dispatches', 'other_billed', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('dispatches', 'vehicle_type', `TEXT NOT NULL DEFAULT 'own'`)
  addColumn('dispatches', 'challan_no', `TEXT NOT NULL DEFAULT ''`)
  addColumn('dispatches', 'payment_status', `TEXT NOT NULL DEFAULT 'unpaid'`)
  addColumn('dispatches', 'paid_amount', 'REAL NOT NULL DEFAULT 0')
  // Existing dispatch rows were recorded in m³, so qty_cm mirrors quantity.
  d.exec(`UPDATE dispatches SET qty_cm = quantity WHERE qty_cm = 0 AND quantity <> 0`)

  // Outsourced (no-stock) flag on sales/loadings; truck no on rack sales.
  addColumn('dispatches', 'outsourced', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('rack_loadings', 'outsourced', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('rack_sales', 'truck_no', `TEXT NOT NULL DEFAULT ''`)

  // Rack unloading via transporter + per-trip.
  addColumn('rack_unloadings', 'transporter_id', 'INTEGER')
  addColumn('rack_unloadings', 'vehicle_no', `TEXT NOT NULL DEFAULT ''`)
  addColumn('rack_unloadings', 'trips', 'REAL NOT NULL DEFAULT 0')
  addColumn('rack_unloadings', 'per_trip_cm', 'REAL NOT NULL DEFAULT 0')
  addColumn('rack_unloadings', 'total_cm', 'REAL NOT NULL DEFAULT 0')
  addColumn('rack_unloadings', 'rate', 'REAL')
  addColumn('rack_unloadings', 'amount', 'REAL')
  addColumn('rack_unloadings', 'diesel_litres', 'REAL')
  addColumn('rack_unloadings', 'diesel_amount', 'REAL')
  d.exec(`UPDATE rack_unloadings SET total_cm = qty_cm WHERE total_cm = 0 AND qty_cm <> 0`)

  // Business firms, machine→business links, operator-wage & outsource attribution.
  addColumn('assets', 'business_id', 'INTEGER')
  addColumn('wage_entries', 'asset_id', 'INTEGER')
  addColumn('plant_expenses', 'outsource_id', 'INTEGER')

  // Multi-user: link a web session to the user who created it.
  addColumn('sessions', 'user_id', 'INTEGER')
}

function seedDefaults(d: Database.Database): void {
  const row = d.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as
    | { value: string }
    | undefined
  if (!row) {
    // Default admin password is "admin123" — user can change it in Settings.
    d.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run('admin123')
  }

  // Seed the first admin user. Existing installs carry over their current
  // admin password (whether already hashed or legacy plaintext).
  const userCount = (d.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n
  if (userCount === 0) {
    const stored =
      (d.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as
        | { value: string }
        | undefined)?.value || 'admin123'
    // Hash legacy plaintext; reuse an already-hashed value as-is.
    const passwordHash = stored.startsWith('scrypt$') ? stored : hashPassword(stored)
    d.prepare(
      `INSERT INTO users (username, name, password_hash, role, access_level, modules, active)
       VALUES ('admin', 'Administrator', ?, 'admin', 'edit', '[]', 1)`
    ).run(passwordHash)
  }
}

/** Atomically increment a counter and return formatted number, e.g. PUR-000001 */
export function nextNumber(prefix: string, counter: string): string {
  const d = getDb()
  const run = d.transaction(() => {
    d.prepare(
      `INSERT INTO counters (name, current) VALUES (?, 0)
       ON CONFLICT(name) DO NOTHING`
    ).run(counter)
    d.prepare(`UPDATE counters SET current = current + 1 WHERE name = ?`).run(counter)
    const { current } = d.prepare(`SELECT current FROM counters WHERE name = ?`).get(counter) as {
      current: number
    }
    return `${prefix}-${String(current).padStart(6, '0')}`
  })
  return run()
}
